import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { getIdentityReviewInfo } from "@/modules/agent-identity/service";
import { launchCampaign, previewCampaign } from "./campaigns";
import { CAMPAIGN_TRIGGER_EVENTS, eventCampaignName } from "./campaignTypes";
import { revalidateTemplate } from "./templates";

type Row = Record<string, unknown>;

/**
 * COMPLIANCE-P0-15 — event-based campaigns. When a person's lifecycle event
 * (a move, a manager change, a conversion or a rehire) matches an
 * event-based template, a campaign starts for that person: their access and
 * business roles, reviewed by their manager (the template's reviewer, else
 * whoever saved it, takes what nobody else can). Called by the Identity
 * Agent's lifecycle service after the event is recorded.
 *
 * Never throws: a failure is audited and the event stands. Runs as the
 * system with the service role, every read and write pinned to the event's
 * tenant (§14). At most one campaign per template and event (a unique
 * index), so a replayed event starts nothing new. A person with nothing to
 * review gets no campaign.
 */
export async function launchCampaignsForLifecycleEvent(tenantId: string, identityId: string, event: { id: string; eventType: string }, now = new Date()): Promise<number> {
  if (!(CAMPAIGN_TRIGGER_EVENTS as readonly string[]).includes(event.eventType)) return 0;
  let launched = 0;
  try {
    const { data, error } = await supabaseServiceRole()
      .from("certification_campaign_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("campaign_type", "event_based")
      .is("archived_at", null)
      .contains("trigger_events", [event.eventType])
      .limit(20);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const templates = ((data ?? []) as Row[]).filter((t) => t.tenant_id === tenantId);
    if (!templates.length) return 0;
    const person = (await getIdentityReviewInfo(tenantId, [identityId])).get(identityId);
    if (!person) return 0;

    for (const t of templates) {
      const templateId = t.id as string;
      const accountable = ((t.reviewer_id as string | null) ?? (t.created_by as string | null)) || null;
      const v = revalidateTemplate(t);
      if ("error" in v || !accountable) {
        await audit(tenantId, templateId, identityId, event, "failure", { error: "error" in v ? v.error : "the template names nobody to take items no manager can review" });
        continue;
      }
      const input = {
        name: eventCampaignName(v.name, person.displayName, now),
        scopeType: v.scope_type,
        scope: { ...v.scope, identityId },
        cadence: "event_driven" as const,
        reviewerKind: v.reviewer_kind,
        reviewerId: accountable,
        dueDate: v.due_in_days ? new Date(now.getTime() + v.due_in_days * 86_400_000).toISOString() : undefined,
      };
      try {
        if ((await previewCampaign(tenantId, input)).items === 0) {
          await audit(tenantId, templateId, identityId, event, "success", { skipped: "nothing to review" });
          continue;
        }
        const campaign = await launchCampaign(tenantId, accountable, input, { templateId, triggerEventId: event.id, system: true });
        await audit(tenantId, templateId, identityId, event, "success", { campaignId: campaign.id });
        launched++;
      } catch (err) {
        if (err instanceof ApiError && err.code === "ALREADY_LAUNCHED") continue;
        await audit(tenantId, templateId, identityId, event, "failure", { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
      }
    }
  } catch (err) {
    console.error("event-based campaigns failed", { tenantId, eventId: event.id, err: err instanceof Error ? err.message : err });
  }
  return launched;
}

async function audit(tenantId: string, templateId: string, identityId: string, event: { id: string; eventType: string }, outcome: "success" | "failure", extra: Record<string, unknown>) {
  await writeAudit({
    tenantId,
    actorType: "system",
    action: "compliance.template_triggered",
    objectType: "certification_campaign_template",
    objectId: templateId,
    outcome,
    metadata: { identityId, lifecycleEventId: event.id, eventType: event.eventType, ...extra },
  });
}

"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { archiveCampaignTemplate, launchCampaign, launchCampaignFromTemplate, recordDecision, saveCampaignTemplate } from "@/modules/certification-compliance/service";
import { campaignFromType } from "@/modules/certification-compliance/campaignTypes";
import { ApiError } from "@/lib/shared/types/foundation";
import type { CampaignCadence, CampaignScopeType, DecisionType } from "@/lib/shared/types/compliance";

export async function launchCampaignAction(formData: FormData) {
  const ctx = await requirePermission("compliance.manage");
  const campaignType = String(formData.get("campaignType") ?? "custom");
  if (campaignType !== "custom") return launchTypedCampaign(ctx, campaignType, formData);
  const criticalityRaw = String(formData.get("criticality") ?? "");
  const days = Number(String(formData.get("dueInDays") ?? "") || 0);
  const dueInDays = Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
  const input = {
    name: String(formData.get("name") ?? ""),
    scopeType: (formData.get("scopeType") as CampaignScopeType) || "agent",
    scope: {
      ...(criticalityRaw ? { criticality: criticalityRaw.split(",").map((s) => s.trim()) } : {}),
      // COMPLIANCE-P0-10: people's access, optionally privileged only.
      ...(formData.get("privilegedOnly") === "on" ? { privilegedOnly: true } : {}),
    },
    reviewerKind: (String(formData.get("reviewerKind") ?? "") || undefined) as "named" | "manager" | "application_owner" | "entitlement_owner" | undefined,
    cadence: (formData.get("cadence") as CampaignCadence) || "one_time",
    // The Reviewer field is optional and submits "" when left blank, and ""
    // is not null — `?? ctx.userId` never fired, so a blank field sent an
    // empty string straight into certification_items.reviewer_id (a uuid).
    // The campaign row was created first, so every default-path launch from
    // this form 500'd AFTER leaving an orphaned active campaign with zero
    // items behind it.
    reviewerId: String(formData.get("reviewerId") ?? "").trim() || ctx.userId,
    // COMPLIANCE-P0-15: the form's "Days to review".
    dueDate: dueInDays ? new Date(Date.now() + dueInDays * 86_400_000).toISOString() : undefined,
  };
  const campaign = await launchCampaign(ctx.tenantId!, ctx.userId, input);
  // COMPLIANCE-P0-14: optionally kept as a template for the next launch (the reviewer stays as typed; blank means whoever launches).
  if (formData.get("saveTemplate") === "on") {
    await saveCampaignTemplate(ctx.tenantId!, ctx.userId, { ...input, dueInDays, reviewerId: String(formData.get("reviewerId") ?? "").trim() || null });
  }
  redirect(`/compliance/campaigns/${campaign.ref ?? campaign.id}`);
}

/**
 * COMPLIANCE-P0-15: a campaign of one of the types. The type decides the
 * scope and who reviews; the form names the target. An event-based type is
 * saved as a template and starts on its events, so nothing launches now.
 */
async function launchTypedCampaign(ctx: { tenantId: string | null; userId: string }, campaignType: string, formData: FormData) {
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  const typed = campaignFromType(campaignType, {
    applicationId: field("applicationId"),
    entitlementId: field("entitlementId"),
    packageId: field("packageId"),
    identityId: field("identityId"),
    privilegedOnly: formData.get("privilegedOnly"),
    triggerEvents: formData.getAll("triggerEvents"),
    microReviewer: field("microReviewer"),
  });
  if ("error" in typed) throw new ApiError(400, "VALIDATION_FAILED", typed.error);
  const days = Number(field("dueInDays") || 0);
  const dueInDays = Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
  const chosenReviewer = field("reviewerId") || null;
  const template = { name: field("name"), scopeType: typed.scopeType, scope: typed.scope, reviewerKind: typed.reviewerKind, reviewerId: chosenReviewer, cadence: typed.cadence, dueInDays, campaignType, triggerEvents: typed.triggerEvents };
  if (campaignType === "event_based") {
    await saveCampaignTemplate(ctx.tenantId!, ctx.userId, template);
    redirect("/compliance/campaigns");
  }
  const campaign = await launchCampaign(ctx.tenantId!, ctx.userId, {
    name: template.name,
    scopeType: typed.scopeType,
    scope: typed.scope,
    cadence: typed.cadence,
    reviewerKind: typed.reviewerKind,
    reviewerId: chosenReviewer ?? ctx.userId,
    dueDate: dueInDays ? new Date(Date.now() + dueInDays * 86_400_000).toISOString() : undefined,
  });
  if (formData.get("saveTemplate") === "on") await saveCampaignTemplate(ctx.tenantId!, ctx.userId, template);
  redirect(`/compliance/campaigns/${campaign.ref ?? campaign.id}`);
}

/** COMPLIANCE-P0-15: turns a template off (archived; campaigns it started stay). */
export async function archiveTemplateAction(templateId: string) {
  const ctx = await requirePermission("compliance.manage");
  await archiveCampaignTemplate(ctx.tenantId!, ctx.userId, templateId);
  redirect("/compliance/campaigns");
}

/** COMPLIANCE-P0-14: an ordinary campaign from a saved template. */
export async function launchFromTemplateAction(templateId: string) {
  const ctx = await requirePermission("compliance.manage");
  const campaign = await launchCampaignFromTemplate(ctx.tenantId!, ctx.userId, templateId);
  redirect(`/compliance/campaigns/${campaign.ref ?? campaign.id}`);
}

export async function recordDecisionAction(campaignId: string, itemId: string, formData: FormData) {
  const ctx = await requirePermission("compliance.read");
  await recordDecision(ctx.tenantId!, ctx.userId, itemId, {
    decision: formData.get("decision") as DecisionType,
    justification: String(formData.get("justification") ?? ""),
    delegateToUserId: String(formData.get("delegateToUserId") ?? "") || undefined,
    overrideSoD: formData.get("overrideSoD") === "on",
    until: String(formData.get("until") ?? "") || undefined,
    canManageCompliance: ctx.permissions.includes("compliance.manage"),
  });
  redirect(`/compliance/campaigns/${campaignId}`);
}

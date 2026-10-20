/**
 * COMPLIANCE-P0-14 part 1 — campaign templates, pure (#9). A template is a
 * saved launch: the scope, who reviews, the cadence and how many days
 * reviewers get. Only known fields are kept; nothing typed reaches a query.
 * COMPLIANCE-P0-15: a template also keeps its campaign type and, for an
 * event-based one, the lifecycle events that start it.
 */

import { CAMPAIGN_TYPES, parseTriggerEvents, reviewerKindAllowed, type CampaignTriggerEvent, type CampaignType } from "./campaignTypes";

const SCOPE_TYPES = ["agent", "application", "entitlement", "privileged_access", "high_risk_agent", "identity_access", "role_assignments", "package_contents", "application_contents", "role_membership"] as const;
const REVIEWER_KINDS = ["named", "manager", "application_owner", "entitlement_owner"] as const;
const CADENCES = ["one_time", "periodic", "event_driven"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TemplateInput = { name?: unknown; scopeType?: unknown; scope?: unknown; reviewerKind?: unknown; reviewerId?: unknown; cadence?: unknown; dueInDays?: unknown; campaignType?: unknown; triggerEvents?: unknown };
export type ValidTemplate = {
  name: string;
  scope_type: (typeof SCOPE_TYPES)[number];
  scope: Record<string, unknown>;
  reviewer_kind: (typeof REVIEWER_KINDS)[number];
  reviewer_id: string | null;
  cadence: (typeof CADENCES)[number];
  due_in_days: number | null;
  campaign_type: CampaignType;
  trigger_events: CampaignTriggerEvent[];
};

export function validateTemplate(input: TemplateInput): ValidTemplate | { error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 120) return { error: "name: 2 to 120 characters" };
  if (!(SCOPE_TYPES as readonly unknown[]).includes(input.scopeType)) return { error: "scopeType: one of the campaign scopes" };
  const scopeType = input.scopeType as ValidTemplate["scope_type"];
  const kind = input.reviewerKind === undefined || input.reviewerKind === null || input.reviewerKind === "" ? "named" : input.reviewerKind;
  if (!(REVIEWER_KINDS as readonly unknown[]).includes(kind)) return { error: "reviewerKind: named, manager, application_owner or entitlement_owner" };
  if (!reviewerKindAllowed(scopeType, kind as string)) {
    return { error: scopeType === "role_assignments" ? "reviewerKind: named or manager for WonderID roles" : "reviewerKind: only people's access and WonderID roles take a manager or owner" };
  }
  const reviewerId = input.reviewerId === undefined || input.reviewerId === null || input.reviewerId === "" ? null : input.reviewerId;
  if (reviewerId !== null && (typeof reviewerId !== "string" || !UUID_RE.test(reviewerId))) return { error: "reviewerId: a member" };
  const cadence = input.cadence === undefined || input.cadence === null || input.cadence === "" ? "one_time" : input.cadence;
  if (!(CADENCES as readonly unknown[]).includes(cadence)) return { error: "cadence: one_time, periodic or event_driven" };
  let due: number | null = null;
  if (input.dueInDays !== undefined && input.dueInDays !== null && input.dueInDays !== "") {
    due = Number(input.dueInDays);
    if (!Number.isInteger(due) || due < 1 || due > 365) return { error: "dueInDays: 1 to 365" };
  }
  const raw = input.scope && typeof input.scope === "object" && !Array.isArray(input.scope) ? (input.scope as Record<string, unknown>) : {};
  const scope: Record<string, unknown> = {};
  if (raw.privilegedOnly === true) scope.privilegedOnly = true;
  if (raw.includeRoles === true) scope.includeRoles = true;
  for (const key of ["applicationId", "entitlementId", "packageId", "identityId"] as const) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    if (typeof raw[key] !== "string" || !UUID_RE.test(raw[key] as string)) return { error: `scope.${key}: an id` };
    scope[key] = raw[key];
  }
  if (Array.isArray(raw.criticality)) scope.criticality = raw.criticality.filter((c): c is string => typeof c === "string" && c.length <= 40).slice(0, 10);
  if (typeof raw.minRiskScore === "number" && raw.minRiskScore >= 0 && raw.minRiskScore <= 100) scope.minRiskScore = raw.minRiskScore;
  const type = input.campaignType === undefined || input.campaignType === null || input.campaignType === "" ? "custom" : input.campaignType;
  if (!(CAMPAIGN_TYPES as readonly unknown[]).includes(type)) return { error: "campaignType: one of the campaign types" };
  const triggers = parseTriggerEvents(input.triggerEvents);
  // COMPLIANCE-P0-15: an event-based template runs on events and needs one; nothing else takes triggers.
  if (type === "event_based" && (!triggers.length || cadence !== "event_driven")) return { error: "triggerEvents: at least one event, with an event-driven cadence" };
  if (type !== "event_based" && triggers.length) return { error: "triggerEvents: only an event-based template has them" };
  if (scopeType === "role_membership" && !scope.packageId) return { error: "scope.packageId: the role to review" };
  return {
    name,
    scope_type: scopeType,
    scope,
    reviewer_kind: kind as ValidTemplate["reviewer_kind"],
    reviewer_id: reviewerId as string | null,
    cadence: cadence as ValidTemplate["cadence"],
    due_in_days: due,
    campaign_type: type as CampaignType,
    trigger_events: triggers,
  };
}

/** A launch from a template: dated name, due date from the template's days. */
export function launchFromTemplateInput(t: ValidTemplate, actorId: string, now: Date) {
  return {
    name: `${t.name} — ${now.toISOString().slice(0, 10)}`,
    scopeType: t.scope_type,
    scope: t.scope,
    cadence: t.cadence,
    reviewerKind: t.reviewer_kind,
    reviewerId: t.reviewer_id ?? actorId,
    dueDate: t.due_in_days ? new Date(now.getTime() + t.due_in_days * 86_400_000).toISOString() : undefined,
  };
}

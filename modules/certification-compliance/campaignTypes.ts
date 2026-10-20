/**
 * COMPLIANCE-P0-15 — certification campaign types, pure (#9). Each type is
 * a ready-made design over the existing campaign scopes: who is reviewed,
 * what is reviewed and who reviews it. A type never adds a decision path of
 * its own; it picks a scope, a reviewer kind and a cadence the launch
 * already validates. Imported by the launch form too, so it stays free of
 * server code.
 *
 * - user_manager: managers review their direct reports' accounts,
 *   entitlements and business roles.
 * - entitlement_owner: an entitlement's owner reviews everyone who holds it.
 * - application_owner: an application's owners (business, else technical)
 *   review every account, entitlement and role on it.
 * - role_based: a business role's owner reviews everyone assigned to it.
 * - event_based: launched by itself when a person moves, changes manager,
 *   converts or is rehired; their manager reviews what they hold.
 * - micro: one person and one entitlement, on demand.
 * - custom: the full launch form.
 */

export const CAMPAIGN_TYPES = ["user_manager", "entitlement_owner", "application_owner", "role_based", "event_based", "micro", "custom"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

/** The lifecycle events an event-based campaign may start on (a leaver's access is removed, not reviewed). */
export const CAMPAIGN_TRIGGER_EVENTS = ["mover", "manager_change", "conversion", "rehire"] as const;
export type CampaignTriggerEvent = (typeof CAMPAIGN_TRIGGER_EVENTS)[number];

export const TRIGGER_LABEL: Record<CampaignTriggerEvent, string> = {
  mover: "Department, title, business unit or location change",
  manager_change: "Manager change",
  conversion: "Employment type change",
  rehire: "Rehire",
};

export const CAMPAIGN_TYPE_INFO: Record<CampaignType, { label: string; summary: string; reviewer: string }> = {
  user_manager: { label: "User manager", summary: "Managers certify the accounts, entitlements and business roles of their direct reports.", reviewer: "Each person's manager" },
  entitlement_owner: { label: "Entitlement owner", summary: "The entitlement's owner certifies everyone who holds it.", reviewer: "The entitlement's owner" },
  application_owner: { label: "Application owner", summary: "The application's owner certifies every account, entitlement and role on it.", reviewer: "The application's business owner, else its technical owner" },
  role_based: { label: "Role-based", summary: "The role's owner certifies everyone assigned to a business role.", reviewer: "The role's owner" },
  event_based: { label: "Event-based", summary: "Starts by itself when a person moves or changes manager; their manager reviews what they hold.", reviewer: "The person's manager" },
  micro: { label: "Micro-certification", summary: "One person and one entitlement, reviewed now.", reviewer: "The person's manager" },
  custom: { label: "Custom", summary: "Choose the scope, cadence and reviewer yourself.", reviewer: "As chosen" },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);

/** What the form sends for a type; anything else is ignored. */
export type CampaignTypeFields = {
  applicationId?: unknown;
  entitlementId?: unknown;
  packageId?: unknown;
  identityId?: unknown;
  privilegedOnly?: unknown;
  triggerEvents?: unknown;
  microReviewer?: unknown;
};

export type TypedCampaign = {
  scopeType: "identity_access" | "role_membership";
  scope: Record<string, unknown>;
  reviewerKind: "named" | "manager" | "application_owner" | "entitlement_owner";
  cadence: "one_time" | "periodic" | "event_driven";
  triggerEvents: CampaignTriggerEvent[];
};

/** The triggers chosen, in a fixed order, known ones only. */
export function parseTriggerEvents(v: unknown): CampaignTriggerEvent[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return CAMPAIGN_TRIGGER_EVENTS.filter((e) => list.some((x) => typeof x === "string" && x.trim() === e));
}

/**
 * A type and its fields as a campaign: scope, reviewer kind, cadence and,
 * for an event-based type, its triggers. Refuses a missing or malformed
 * target; never guesses one (§19.2).
 */
export function campaignFromType(type: unknown, f: CampaignTypeFields): TypedCampaign | { error: string } {
  const privileged = f.privilegedOnly === true || f.privilegedOnly === "on" || f.privilegedOnly === "true";
  const base = { cadence: "periodic" as const, triggerEvents: [] as CampaignTriggerEvent[] };
  switch (type) {
    case "user_manager":
      return { ...base, scopeType: "identity_access", reviewerKind: "manager", scope: { includeRoles: true, ...(privileged ? { privilegedOnly: true } : {}) } };
    case "entitlement_owner": {
      const entitlementId = id(f.entitlementId);
      if (!entitlementId) return { error: "Choose the entitlement to review" };
      return { ...base, scopeType: "identity_access", reviewerKind: "entitlement_owner", scope: { entitlementId } };
    }
    case "application_owner": {
      const applicationId = id(f.applicationId);
      if (!applicationId) return { error: "Choose the application to review" };
      return { ...base, scopeType: "identity_access", reviewerKind: "application_owner", scope: { applicationId, includeRoles: true, ...(privileged ? { privilegedOnly: true } : {}) } };
    }
    case "role_based": {
      const packageId = id(f.packageId);
      if (!packageId) return { error: "Choose the role to review" };
      return { ...base, scopeType: "role_membership", reviewerKind: "named", scope: { packageId } };
    }
    case "event_based": {
      const triggerEvents = parseTriggerEvents(f.triggerEvents);
      if (!triggerEvents.length) return { error: "Choose at least one event that starts the campaign" };
      return { scopeType: "identity_access", reviewerKind: "manager", cadence: "event_driven", triggerEvents, scope: { includeRoles: true } };
    }
    case "micro": {
      const identityId = id(f.identityId);
      const entitlementId = id(f.entitlementId);
      if (!identityId) return { error: "Choose the person" };
      if (!entitlementId) return { error: "Choose the entitlement" };
      const reviewerKind = f.microReviewer === "entitlement_owner" || f.microReviewer === "named" ? f.microReviewer : "manager";
      return { ...base, cadence: "one_time", scopeType: "identity_access", reviewerKind, scope: { identityId, entitlementId } };
    }
    default:
      return { error: "Choose a campaign type" };
  }
}

/** Which reviewer kinds a campaign scope takes (the launch and templates refuse the rest). */
export function reviewerKindAllowed(scopeType: string, kind: string): boolean {
  if (kind === "named") return true;
  if (scopeType === "identity_access") return kind === "manager" || kind === "application_owner" || kind === "entitlement_owner";
  if (scopeType === "role_assignments") return kind === "manager";
  return false;
}

/** An event-based campaign's name: the template, the person and the day. */
export function eventCampaignName(templateName: string, personName: string, now: Date): string {
  return `${templateName} — ${personName} — ${now.toISOString().slice(0, 10)}`.slice(0, 200);
}

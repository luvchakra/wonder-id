import { describe, expect, it } from "vitest";
import { campaignFromType, eventCampaignName, parseTriggerEvents, reviewerKindAllowed } from "./campaignTypes";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("campaign types (COMPLIANCE-P0-15)", () => {
  it("user manager: managers review direct reports' access and business roles", () => {
    expect(campaignFromType("user_manager", {})).toEqual({ scopeType: "identity_access", reviewerKind: "manager", cadence: "periodic", triggerEvents: [], scope: { includeRoles: true } });
    expect(campaignFromType("user_manager", { privilegedOnly: "on" })).toMatchObject({ scope: { includeRoles: true, privilegedOnly: true } });
  });

  it("entitlement owner: one entitlement, its owner reviews", () => {
    expect(campaignFromType("entitlement_owner", { entitlementId: A })).toMatchObject({ scopeType: "identity_access", reviewerKind: "entitlement_owner", scope: { entitlementId: A } });
    expect(campaignFromType("entitlement_owner", {})).toHaveProperty("error");
  });

  it("application owner: one application, with its roles", () => {
    expect(campaignFromType("application_owner", { applicationId: A })).toMatchObject({ reviewerKind: "application_owner", scope: { applicationId: A, includeRoles: true } });
    expect(campaignFromType("application_owner", { applicationId: "x' or 1=1" })).toHaveProperty("error");
  });

  it("role-based: the members of one business role", () => {
    expect(campaignFromType("role_based", { packageId: B })).toMatchObject({ scopeType: "role_membership", reviewerKind: "named", scope: { packageId: B } });
    expect(campaignFromType("role_based", { packageId: "" })).toHaveProperty("error");
  });

  it("event-based: needs an event, runs event-driven, reviewed by the manager", () => {
    expect(campaignFromType("event_based", { triggerEvents: ["manager_change", "leaver", "mover"] })).toEqual({
      scopeType: "identity_access",
      reviewerKind: "manager",
      cadence: "event_driven",
      triggerEvents: ["mover", "manager_change"],
      scope: { includeRoles: true },
    });
    expect(campaignFromType("event_based", { triggerEvents: ["leaver"] })).toHaveProperty("error");
  });

  it("micro: one person and one entitlement, now; the reviewer kind is a closed list", () => {
    expect(campaignFromType("micro", { identityId: A, entitlementId: B })).toMatchObject({ cadence: "one_time", reviewerKind: "manager", scope: { identityId: A, entitlementId: B } });
    expect(campaignFromType("micro", { identityId: A, entitlementId: B, microReviewer: "entitlement_owner" })).toMatchObject({ reviewerKind: "entitlement_owner" });
    expect(campaignFromType("micro", { identityId: A, entitlementId: B, microReviewer: "the_ceo" })).toMatchObject({ reviewerKind: "manager" });
    expect(campaignFromType("micro", { identityId: A })).toHaveProperty("error");
    expect(campaignFromType("micro", { entitlementId: B })).toHaveProperty("error");
  });

  it("refuses an unknown type, and custom (the full form decides)", () => {
    expect(campaignFromType("everything", {})).toHaveProperty("error");
    expect(campaignFromType("custom", {})).toHaveProperty("error");
  });

  it("parses triggers from a list or a comma string, known ones only", () => {
    expect(parseTriggerEvents("rehire, mover,joiner")).toEqual(["mover", "rehire"]);
    expect(parseTriggerEvents(undefined)).toEqual([]);
  });

  it("reviewer kinds by scope", () => {
    expect(reviewerKindAllowed("identity_access", "entitlement_owner")).toBe(true);
    expect(reviewerKindAllowed("role_assignments", "manager")).toBe(true);
    expect(reviewerKindAllowed("role_assignments", "application_owner")).toBe(false);
    expect(reviewerKindAllowed("role_membership", "manager")).toBe(false);
    expect(reviewerKindAllowed("agent", "named")).toBe(true);
  });

  it("an event campaign is named for the template, the person and the day", () => {
    expect(eventCampaignName("Mover review", "Ada Lovelace", new Date("2026-10-20T08:00:00Z"))).toBe("Mover review — Ada Lovelace — 2026-10-20");
  });
});

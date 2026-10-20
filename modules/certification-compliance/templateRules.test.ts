import { describe, expect, it } from "vitest";
import { launchFromTemplateInput, validateTemplate } from "./templateRules";

const ok = { name: "Quarterly admin review", scopeType: "role_assignments", scope: { privilegedOnly: true }, reviewerKind: "manager", cadence: "periodic", dueInDays: 14 };

describe("campaign templates (COMPLIANCE-P0-14)", () => {
  it("keeps only known fields", () => {
    const v = validateTemplate({ ...ok, scope: { privilegedOnly: true, sneaky: "drop table", applicationId: "" } });
    expect(v).toEqual({ name: "Quarterly admin review", scope_type: "role_assignments", scope: { privilegedOnly: true }, reviewer_kind: "manager", reviewer_id: null, cadence: "periodic", due_in_days: 14, campaign_type: "custom", trigger_events: [] });
  });
  it("refuses what a launch would refuse", () => {
    expect(validateTemplate({ ...ok, name: "x" })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, scopeType: "everything" })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, reviewerKind: "application_owner" })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, scopeType: "agent", reviewerKind: "manager" })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, dueInDays: 0 })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, dueInDays: 1.5 })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, reviewerId: "not-an-id" })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, scope: { applicationId: "x' or 1=1" } })).toHaveProperty("error");
  });
  it("COMPLIANCE-P0-15: keeps the campaign type; triggers only on an event-based, event-driven template", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const event = { name: "Mover review", scopeType: "identity_access", scope: { includeRoles: true }, reviewerKind: "manager", cadence: "event_driven", campaignType: "event_based", triggerEvents: ["mover", "leaver"] };
    expect(validateTemplate(event)).toMatchObject({ campaign_type: "event_based", trigger_events: ["mover"], scope: { includeRoles: true } });
    expect(validateTemplate({ ...event, triggerEvents: [] })).toHaveProperty("error");
    expect(validateTemplate({ ...event, cadence: "periodic" })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, triggerEvents: ["mover"] })).toHaveProperty("error");
    expect(validateTemplate({ ...ok, campaignType: "anything" })).toHaveProperty("error");
    expect(validateTemplate({ name: "Owner review", scopeType: "identity_access", reviewerKind: "entitlement_owner", scope: { entitlementId: id }, campaignType: "entitlement_owner" })).toMatchObject({ reviewer_kind: "entitlement_owner", scope: { entitlementId: id } });
    expect(validateTemplate({ name: "Role review", scopeType: "role_membership", scope: {}, campaignType: "role_based" })).toHaveProperty("error");
    expect(validateTemplate({ name: "Role review", scopeType: "role_membership", scope: { packageId: id }, reviewerKind: "manager", campaignType: "role_based" })).toHaveProperty("error");
    expect(validateTemplate({ name: "Micro", scopeType: "identity_access", scope: { identityId: "nope" }, campaignType: "micro" })).toHaveProperty("error");
  });
  it("a launch from a template is dated and due after its days; the launcher reviews when no reviewer is named", () => {
    const v = validateTemplate(ok);
    if ("error" in v) throw new Error(v.error);
    const input = launchFromTemplateInput(v, "u-me", new Date("2026-10-14T10:00:00Z"));
    expect(input).toMatchObject({ name: "Quarterly admin review — 2026-10-14", reviewerId: "u-me", reviewerKind: "manager", dueDate: "2026-10-28T10:00:00.000Z" });
  });
});

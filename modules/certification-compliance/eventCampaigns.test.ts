// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

/** COMPLIANCE-P0-15: event-based campaigns start from a person's lifecycle event. */

const mockLaunch = vi.fn();
const mockPreview = vi.fn();
vi.mock("./campaigns", () => ({ launchCampaign: (...a: unknown[]) => mockLaunch(...a), previewCampaign: (...a: unknown[]) => mockPreview(...a) }));
vi.mock("./templates", async () => {
  const rules = await import("./templateRules");
  return {
    revalidateTemplate: (r: Record<string, unknown>) =>
      rules.validateTemplate({ name: r.name, scopeType: r.scope_type, scope: r.scope, reviewerKind: r.reviewer_kind, reviewerId: r.reviewer_id, cadence: r.cadence, dueInDays: r.due_in_days, campaignType: r.campaign_type, triggerEvents: r.trigger_events }),
  };
});
vi.mock("@/modules/agent-identity/service", () => ({
  getIdentityReviewInfo: async () => new Map([["person-1", { displayName: "Ada Lovelace", identityType: "HUMAN", userId: "u-ada", managerIdentityId: "m-1", ownerIdentityId: null }]]),
}));
const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (e: unknown) => writeAudit(e) }));

let templates: Record<string, unknown>[] = [];
const filters: [string, unknown][] = [];
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => {
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push([k, v]), q),
      is: () => q,
      contains: (k: string, v: unknown) => (filters.push([k, v]), q),
      limit: async () => ({ data: templates, error: null }),
    };
    return { from: () => q };
  },
}));

import { launchCampaignsForLifecycleEvent } from "./eventCampaigns";
import { ApiError } from "@/lib/shared/types/foundation";

const template = {
  id: "tpl-1",
  tenant_id: "t-a",
  name: "Mover review",
  scope_type: "identity_access",
  scope: { includeRoles: true },
  reviewer_kind: "manager",
  reviewer_id: null,
  created_by: "u-admin",
  cadence: "event_driven",
  due_in_days: 7,
  campaign_type: "event_based",
  trigger_events: ["mover"],
};
const now = new Date("2026-10-20T08:00:00Z");

describe("event-based campaigns (COMPLIANCE-P0-15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filters.length = 0;
    templates = [template];
    mockPreview.mockResolvedValue({ items: 3 });
    mockLaunch.mockResolvedValue({ id: "camp-1" });
  });

  it("launches for the person, as the system, once per template and event", async () => {
    expect(await launchCampaignsForLifecycleEvent("t-a", "person-1", { id: "ev-1", eventType: "mover" }, now)).toBe(1);
    expect(filters).toEqual(expect.arrayContaining([["tenant_id", "t-a"], ["campaign_type", "event_based"], ["trigger_events", ["mover"]]]));
    expect(mockLaunch).toHaveBeenCalledWith(
      "t-a",
      "u-admin",
      expect.objectContaining({ name: "Mover review — Ada Lovelace — 2026-10-20", scope: { includeRoles: true, identityId: "person-1" }, reviewerKind: "manager", reviewerId: "u-admin", dueDate: "2026-10-27T08:00:00.000Z" }),
      { templateId: "tpl-1", triggerEventId: "ev-1", system: true },
    );
  });

  it("ignores events no template may start on, and another tenant's template", async () => {
    expect(await launchCampaignsForLifecycleEvent("t-a", "person-1", { id: "ev-1", eventType: "leaver" }, now)).toBe(0);
    templates = [{ ...template, tenant_id: "t-b" }];
    expect(await launchCampaignsForLifecycleEvent("t-a", "person-1", { id: "ev-1", eventType: "mover" }, now)).toBe(0);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("starts nothing for a person with nothing to review, and nothing twice", async () => {
    mockPreview.mockResolvedValueOnce({ items: 0 });
    expect(await launchCampaignsForLifecycleEvent("t-a", "person-1", { id: "ev-1", eventType: "mover" }, now)).toBe(0);
    mockLaunch.mockRejectedValueOnce(new ApiError(409, "ALREADY_LAUNCHED"));
    expect(await launchCampaignsForLifecycleEvent("t-a", "person-1", { id: "ev-1", eventType: "mover" }, now)).toBe(0);
    expect(writeAudit).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }));
  });

  it("never throws: a failed launch is audited and the event stands", async () => {
    mockLaunch.mockRejectedValueOnce(new Error("database down"));
    expect(await launchCampaignsForLifecycleEvent("t-a", "person-1", { id: "ev-1", eventType: "mover" }, now)).toBe(0);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "compliance.template_triggered", outcome: "failure" }));
  });
});

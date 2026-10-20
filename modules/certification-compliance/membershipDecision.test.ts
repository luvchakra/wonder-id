// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

/** COMPLIANCE-P0-15: a decision on a person's business-role assignment. */

const mockRevokeAssignment = vi.fn();
vi.mock("@/modules/access-governance/service", () => ({
  revokeAssignment: (...a: unknown[]) => mockRevokeAssignment(...a),
}));
const mockReviewInfo = vi.fn();
vi.mock("@/modules/agent-identity/service", () => ({
  getIdentityReviewInfo: (...a: unknown[]) => mockReviewInfo(...a),
  listOwners: vi.fn(),
}));
vi.mock("./snapshot", () => ({ buildFreshSnapshot: vi.fn() }));
const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

let itemRow: Record<string, unknown> | null = null;
const inserted: Record<string, unknown>[] = [];
function makeFrom(table: string) {
  if (table === "certification_items") {
    return {
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: itemRow, error: null }) }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
  }
  if (table === "certification_decisions") {
    return { insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => (inserted.push(row), { data: { id: "d-1", ...row }, error: null }) }) }) };
  }
  throw new Error(`unexpected table ${table}`);
}
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: (t: string) => makeFrom(t) }),
  supabaseServiceRole: () => ({ from: (t: string) => makeFrom(t) }),
}));

import { recordDecision } from "./decisions";

describe("role membership decisions (COMPLIANCE-P0-15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserted.length = 0;
    itemRow = { id: "item-1", tenant_id: "t-a", campaign_id: "c-1", identity_id: "person-1", package_id: "pkg-1", package_assignment_id: "asg-1", reviewer_id: "u-owner", status: "pending", snapshot: {} };
    mockReviewInfo.mockResolvedValue(new Map([["person-1", { displayName: "Ada", identityType: "HUMAN", userId: "u-ada", managerIdentityId: null, ownerIdentityId: null }]]));
  });

  it("revoke ends the assignment through Access before recording the decision", async () => {
    await recordDecision("t-a", "u-owner", "item-1", { decision: "revoke", justification: "Moved teams" });
    expect(mockRevokeAssignment).toHaveBeenCalledWith("t-a", "u-owner", "asg-1", "Revoked in an access review: Moved teams");
    expect(inserted[0]).toMatchObject({ decision: "revoke", remediation_id: "asg-1" });
  });

  it("certify keeps it and changes nothing in Access", async () => {
    await recordDecision("t-a", "u-owner", "item-1", { decision: "approve", justification: "Still needed" });
    expect(mockRevokeAssignment).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "compliance.access_certified" }));
  });

  it("a failed end records nothing", async () => {
    mockRevokeAssignment.mockRejectedValueOnce(new Error("This assignment has already ended"));
    await expect(recordDecision("t-a", "u-owner", "item-1", { decision: "revoke", justification: "x" })).rejects.toThrow();
    expect(inserted).toHaveLength(0);
  });

  it("nobody certifies their own role, and an exception is refused", async () => {
    itemRow = { ...itemRow!, reviewer_id: "u-ada" };
    await expect(recordDecision("t-a", "u-ada", "item-1", { decision: "approve", justification: "mine" })).rejects.toMatchObject({ code: "SELF_CERTIFICATION" });
    itemRow = { ...itemRow!, reviewer_id: "u-owner" };
    await expect(recordDecision("t-a", "u-owner", "item-1", { decision: "exception", justification: "later", until: new Date(Date.now() + 86_400_000).toISOString() })).rejects.toMatchObject({ status: 400 });
    expect(inserted).toHaveLength(0);
  });
});

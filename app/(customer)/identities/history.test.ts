import { describe, expect, it } from "vitest";
import { describeAuditEvent } from "./history";

const ev = (action: string, metadata: Record<string, unknown> = {}, objectType = "identity") => ({ action, objectType, outcome: "success", metadata });

describe("describeAuditEvent (owner feedback, 21 Oct)", () => {
  it("names known actions in plain words", () => {
    expect(describeAuditEvent(ev("identity.created")).title).toBe("Identity created");
    expect(describeAuditEvent(ev("access.request_submitted", {}, "access_request"))).toEqual({ title: "Access requested", detail: null });
  });
  it("says which fields changed, never their values", () => {
    expect(describeAuditEvent(ev("identity.updated", { changed: ["displayName", "email", "managerIdentityId", "cost_center"] })).detail).toBe("Changed: full name, email, manager, cost center");
  });
  it("gives a status change from and to", () => {
    expect(describeAuditEvent(ev("identity.status_changed", { changed: ["status"], from: "active", to: "disabled" })).detail).toBe("Changed: status · from active to disabled");
  });
  it("falls back to the action's own words, and says what kind of object it was on", () => {
    expect(describeAuditEvent(ev("access.fulfilment_task_opened", {}, "access_request"))).toEqual({ title: "Fulfilment task opened", detail: "on an access request" });
    expect(describeAuditEvent(ev("access.reconciled", {}, "account")).detail).toBe("on an account");
  });
});

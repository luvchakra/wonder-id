import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * ACCESS-P0-22 part 1 — access one identity must not hold together, against
 * the real app and database:
 * - a warning rule sends a request that would combine them to a person,
 *   never automatic approval, and records the conflict on the request;
 * - a blocking rule refuses the request, and refuses an approval that would
 *   now complete the combination;
 * - the detective view lists identities that already hold both;
 * - another organization sees none of it.
 * The rule sits on an identity policy that is disabled at the end, so it
 * never affects other specs (it names only this spec's entitlements).
 */

const stamp = Date.now();
const ids = { app: "", vendor: "", pay: "", report: "", policy: "", p: "", q: "", r: "", pending: "" };

async function promote(request: APIRequestContext, browser: Browser, id: string) {
  const owner = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E SoD Owner ${stamp}` } });
  const ownerId = (await owner.json()).data.id;
  expect((await request.patch(`/api/v1/access/applications/${id}`, { data: { businessOwnerIdentityId: ownerId, technicalOwnerIdentityId: ownerId } })).status()).toBe(200);
  const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${id}/onboarding`, { data });
  await onb({ action: "start" });
  await onb({
    action: "configure",
    config: { accountIdentifierField: "id", correlationAccountField: "email", correlationIdentityField: "email", entitlementSource: "manual", requestPolicy: "manager_approval", certificationPolicy: "annual", provenanceEnabled: true },
  });
  await onb({ action: "validate" });
  await onb({ action: "simulate" });
  const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
  expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
  await iam.close();
  expect((await onb({ action: "promote" })).status()).toBe(200);
}

const submit = (request: APIRequestContext, data: Record<string, unknown>) => request.post("/api/v1/access/requests", { data });
const person = async (request: APIRequestContext, name: string) => (await (await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: name } })).json()).data.id as string;

test.describe.serial("separation of duties over access", () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ storageState: authFile("adminOne") });

  test("setup: a live application with three entitlements, approved automatically", async ({ request, browser }) => {
    test.setTimeout(180_000);
    const app = await request.post("/api/v1/access/applications", { data: { name: `E2E SoD Access App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } });
    ids.app = (await app.json()).data.id;
    const ent = async (name: string) => (await (await request.post(`/api/v1/access/applications/${ids.app}/entitlements`, { data: { name, dataClassification: "internal", privilegeLevel: "standard" } })).json()).data.id as string;
    ids.vendor = await ent("Create vendor");
    ids.pay = await ent("Approve payment");
    ids.report = await ent("Run reports");
    await promote(request, browser, ids.app);
    const policy = await request.post("/api/v1/access/request-policies", { data: { applicationId: ids.app, name: `E2E SoD Access Policy ${stamp}`, autoApprove: true, riskThreshold: "high", allowForOthers: "managers" } });
    expect(policy.status(), await policy.text()).toBe(200);

    ids.p = await person(request, `E2E SoD P ${stamp}`);
    ids.q = await person(request, `E2E SoD Q ${stamp}`);
    ids.r = await person(request, `E2E SoD R ${stamp}`);
    // Before any rule: R gets both (the detective view's case); P and Q get "Create vendor".
    for (const [subject, entitlementId] of [
      [ids.r, ids.vendor],
      [ids.r, ids.pay],
      [ids.p, ids.vendor],
      [ids.q, ids.vendor],
    ]) {
      const res = await submit(request, { applicationId: ids.app, entitlementId, subjectIdentityId: subject, justification: "Accounts payable setup" });
      expect(res.status(), await res.text()).toBe(201);
      expect((await res.json()).data.status).toBe("approved");
    }
  });

  test("a warning rule: the combining request goes to a person, with the conflict recorded", async ({ request }) => {
    const policy = await request.post("/api/v1/policies", { data: { name: `E2E Access SoD ${stamp}`, policyCategory: "identity", action: "flag", severity: "high" } });
    expect(policy.status(), await policy.text()).toBe(201);
    ids.policy = (await policy.json()).data.id;
    const rule = await request.post(`/api/v1/policies/${ids.policy}/rules`, { data: { ruleType: "rbac", condition: { conflictingAccess: { left: [ids.vendor], right: [ids.pay] } } } });
    expect(rule.status(), await rule.text()).toBe(201);

    const res = await submit(request, { applicationId: ids.app, entitlementId: ids.pay, subjectIdentityId: ids.p, justification: "Covering payments this week" });
    expect(res.status(), await res.text()).toBe(201);
    const r = (await res.json()).data as { id: string; status: string; policyResult: { checks: { check: string; result: string }[] } };
    ids.pending = r.id;
    expect(r.status).toBe("pending");
    expect(r.policyResult.checks.find((c) => c.check === "sod")?.result).toContain(`E2E Access SoD ${stamp}`);
    // Unrelated access is not affected by the rule.
    const other = await submit(request, { applicationId: ids.app, entitlementId: ids.report, subjectIdentityId: ids.p, justification: "Month-end reporting" });
    expect((await other.json()).data.status).toBe("approved");
  });

  test("a blocking rule refuses the request, and an approval that would now combine them", async ({ request, browser }) => {
    expect((await request.patch(`/api/v1/policies/${ids.policy}`, { data: { action: "block" } })).status()).toBe(200);
    const refused = await submit(request, { applicationId: ids.app, entitlementId: ids.pay, subjectIdentityId: ids.q, justification: "Covering payments this week" });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error.code).toBe("SOD_CONFLICT");

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const approve = await iam.request.post(`/api/v1/access/requests/${ids.pending}/decision`, { data: { decision: "approved" } });
    expect(approve.status()).toBe(409);
    expect((await approve.json()).error.code).toBe("SOD_CONFLICT");
    // Rejecting it is always possible.
    expect((await iam.request.post(`/api/v1/access/requests/${ids.pending}/decision`, { data: { decision: "rejected", comment: "Separation of duties" } })).status()).toBe(200);
    await iam.close();
  });

  test("the SoD pages show the rule and who already holds both; another organization sees neither", async ({ page, browser }) => {
    await page.goto("/sod");
    await expect(page.getByRole("table", { name: "Access conflict rules" })).toContainText(`E2E SoD Access App ${stamp} · Create vendor`);
    await page.goto("/sod/conflicts");
    const held = page.getByTestId("held-access-conflicts");
    await expect(held).toContainText(`E2E SoD R ${stamp}`);
    await expect(held).not.toContainText(`E2E SoD P ${stamp}`);

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const p2 = await two.newPage();
    await p2.goto("/sod/conflicts");
    await expect(p2.getByRole("heading", { name: "SoD Conflicts" })).toBeVisible();
    await expect(p2.getByText(`E2E SoD R ${stamp}`)).toHaveCount(0);
    await p2.goto("/sod");
    await expect(p2.getByText(`E2E SoD Access App ${stamp}`)).toHaveCount(0);
    await two.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!ids.policy) return;
    const ctx = await browser.newContext({ storageState: authFile("adminOne") });
    await ctx.request.patch(`/api/v1/policies/${ids.policy}`, { data: { status: "disabled" } });
    await ctx.close();
  });
});

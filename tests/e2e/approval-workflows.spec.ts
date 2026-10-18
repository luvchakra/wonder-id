import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * Approval workflows (owner request 2026-10-18) — access requests through
 * reusable, multi-level approval patterns, against the real app and database:
 * - a workflow is validated (levels, named people) and its name is unique;
 * - one workflow serves the policies of two applications; an entitlement's
 *   own policy can use another workflow;
 * - levels run in order: the subject's manager, then a group where any
 *   member approves; nobody decides out of turn, and the manager cannot
 *   approve again as a group member;
 * - a level from high risk applies only to a risky request; a rejection
 *   at a middle level closes the request;
 * - in an "any" level, one approval skips the others;
 * - a changed workflow applies to new requests; requests already waiting
 *   keep their approvers;
 * - a workflow in use cannot be retired; a retired one cannot be chosen;
 * - another organization sees and uses none of it.
 *
 * The subjects are this spec's own people (their manager is the IAM
 * administrator), so no shared test identity changes.
 */

const stamp = Date.now();
const ids = { app1: "", app2: "", reader1: "", admin1: "", writer1: "", reader2: "", viewer2: "", w1: "", w2: "", w3: "", g1: "", g2: "", s1: "", s2: "", s3: "", s4: "", iam: "", readOnly: "", waiting: "" };
let tenantId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function person(email: string): Promise<{ identityId: string; userId: string }> {
  const { data, error } = await db().from("identities").select("id, user_id").eq("tenant_id", tenantId).eq("identity_type", "HUMAN").eq("email", email).limit(1).single();
  if (error || !data) throw new Error(`no identity for ${email}: ${error?.message}`);
  return { identityId: data.id as string, userId: data.user_id as string };
}

async function promote(request: APIRequestContext, browser: Browser, id: string, ownerId: string) {
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

type Step = { stage: number; approverKind: string; approverIdentityId: string | null; approverGroupId: string | null; stageRule: string; status: string; reason: string | null };
type Detail = { request: { id: string; status: string; approvalStage: number | null; riskLevel: string }; steps: Step[] };

const detail = async (ctx: APIRequestContext, id: string): Promise<Detail> => {
  const res = await ctx.get(`/api/v1/access/requests/${id}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data as Detail;
};
const decide = (ctx: APIRequestContext, id: string, decision: string, comment?: string) => ctx.post(`/api/v1/access/requests/${id}/decision`, { data: { decision, comment } });
const shape = (d: Detail) => d.steps.filter((s) => s.status !== "invalidated").map((s) => [s.stage, s.approverKind, s.approverGroupId ?? s.approverIdentityId, s.status]);

test.describe.serial("approval workflows", () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ storageState: authFile("adminOne") });
  let iam: APIRequestContext;
  let ro: APIRequestContext;
  const contexts: { close: () => Promise<void> }[] = [];

  test.beforeAll(async ({ browser }) => {
    for (const [key, set] of [
      ["iamAdminOne", (c: APIRequestContext) => (iam = c)],
      ["readOnly", (c: APIRequestContext) => (ro = c)],
    ] as const) {
      const ctx = await browser.newContext({ storageState: authFile(key) });
      contexts.push(ctx);
      set(ctx.request);
    }
  });

  test.afterAll(async () => {
    for (const c of contexts) await c.close();
  });

  test("setup: two live applications, two groups, people with a manager, and validated workflows", async ({ request, browser }) => {
    test.setTimeout(240_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const iamP = await person(TEST_USERS.iamAdminOne.email);
    const roP = await person(TEST_USERS.readOnly.email);
    ids.iam = iamP.identityId;
    ids.readOnly = roP.identityId;

    const app = async (name: string) => (await (await request.post("/api/v1/access/applications", { data: { name, appType: "saas", riskLevel: "low", dataClassification: "internal" } })).json()).data.id as string;
    const ent = async (appId: string, name: string, privilegeLevel = "standard") =>
      (await (await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name, dataClassification: "internal", privilegeLevel } })).json()).data.id as string;
    ids.app1 = await app(`E2E Workflow CRM ${stamp}`);
    ids.app2 = await app(`E2E Workflow ERP ${stamp}`);
    ids.reader1 = await ent(ids.app1, "Reader");
    ids.admin1 = await ent(ids.app1, "Administrator", "admin");
    ids.writer1 = await ent(ids.app1, "Writer");
    ids.reader2 = await ent(ids.app2, "Reader");
    ids.viewer2 = await ent(ids.app2, "Viewer");
    await promote(request, browser, ids.app1, ids.readOnly);
    await promote(request, browser, ids.app2, ids.readOnly);

    // Groups: the data team (the IAM administrator and the read-only user), and the ERP team (the IAM administrator).
    const group = async (name: string, members: string[]) => {
      const res = await request.post("/api/v1/groups", { data: { name } });
      expect(res.status(), await res.text()).toBe(201);
      const id = (await res.json()).data.id as string;
      for (const userId of members) {
        const add = await request.post(`/api/v1/groups/${id}/members`, { data: { userId } });
        expect(add.ok(), await add.text()).toBe(true);
      }
      return id;
    };
    ids.g1 = await group(`E2E Data Team ${stamp}`, [iamP.userId, roP.userId]);
    ids.g2 = await group(`E2E ERP Team ${stamp}`, [iamP.userId]);

    const subject = async (n: number) => {
      const res = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Workflow Subject ${n} ${stamp}`, managerIdentityId: ids.iam } });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data.id as string;
    };
    ids.s1 = await subject(1);
    ids.s2 = await subject(2);
    ids.s3 = await subject(3);
    ids.s4 = await subject(4);

    const create = (data: Record<string, unknown>) => request.post("/api/v1/access/approval-workflows", { data });
    // Validation: no levels, an unknown approver, a person outside the organization.
    expect((await create({ name: `E2E bad ${stamp}`, levels: [] })).status()).toBe(400);
    expect((await create({ name: `E2E bad ${stamp}`, levels: [{ approvers: [{ kind: "ceo" }] }] })).status()).toBe(400);
    expect((await create({ name: `E2E bad ${stamp}`, levels: [{ approvers: [{ kind: "person", identityId: "00000000-0000-4000-8000-000000000001" }] }] })).status()).toBe(400);
    // Only those who manage access create one.
    expect((await ro.post("/api/v1/access/approval-workflows", { data: { name: `E2E ro ${stamp}`, levels: [{ approvers: [{ kind: "manager" }] }] } })).status()).toBe(403);

    const w1 = await create({
      name: `E2E Manager, data team, security ${stamp}`,
      description: "Manager first, then anyone in the data team; security for risky access.",
      levels: [
        { name: "Manager", approvers: [{ kind: "manager" }] },
        { name: "Data team", rule: "any", approvers: [{ kind: "group", groupId: ids.g1 }] },
        { name: "Security", minRisk: "high", approvers: [{ kind: "access_managers" }] },
      ],
    });
    expect(w1.status(), await w1.text()).toBe(201);
    ids.w1 = (await w1.json()).data.id;
    expect((await create({ name: `  e2e manager, DATA team, security ${stamp} `, levels: [{ approvers: [{ kind: "manager" }] }] })).status()).toBe(409);

    const w2 = await create({ name: `E2E Any ERP approver ${stamp}`, levels: [{ name: "ERP", rule: "any", approvers: [{ kind: "person", identityId: ids.readOnly }, { kind: "group", groupId: ids.g2 }] }] });
    expect(w2.status(), await w2.text()).toBe(201);
    ids.w2 = (await w2.json()).data.id;
    const w3 = await create({ name: `E2E Unused ${stamp}`, levels: [{ approvers: [{ kind: "application_owner" }] }] });
    ids.w3 = (await w3.json()).data.id;

    // One workflow for both applications; the ERP Viewer entitlement has its own.
    const policy = (data: Record<string, unknown>) => request.post("/api/v1/access/request-policies", { data: { autoApprove: false, allowForOthers: "managers", ...data } });
    for (const [applicationId, entitlementId, workflow, name] of [
      [ids.app1, undefined, ids.w1, "CRM"],
      [ids.app2, undefined, ids.w1, "ERP"],
      [ids.app2, ids.viewer2, ids.w2, "ERP Viewer"],
    ] as const) {
      const res = await policy({ applicationId, entitlementId, approvalWorkflowId: workflow, name: `E2E Workflow ${name} ${stamp}` });
      expect(res.status(), await res.text()).toBe(200);
    }
    const used = (await (await request.get(`/api/v1/access/approval-workflows/${ids.w1}`)).json()).data as { policies: { name: string }[] };
    expect(used.policies.map((p) => p.name).sort()).toEqual([`E2E Workflow CRM ${stamp}`, `E2E Workflow ERP ${stamp}`]);
  });

  test("levels in order: the manager, then any member of the group; nobody out of turn, nobody twice", async ({ request }) => {
    const res = await request.post("/api/v1/access/requests", { data: { applicationId: ids.app1, entitlementId: ids.reader1, subjectIdentityId: ids.s1, justification: "Joining the sales team" } });
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).data.id as string;
    let d = await detail(request, id);
    expect(d.request).toMatchObject({ status: "pending", approvalStage: 1, riskLevel: "low" });
    // Low risk: the security level does not apply.
    expect(shape(d)).toEqual([
      [1, "manager", ids.iam, "pending"],
      [2, "group", ids.g1, "waiting"],
    ]);
    expect(d.steps[1].stageRule).toBe("any");

    // A group member cannot decide before the group's turn; the requester never decides.
    expect((await (await decide(ro, id, "approved")).json()).error.code).toBe("NOT_AN_APPROVER");
    expect((await (await decide(request, id, "approved")).json()).error.code).toBe("SELF_APPROVAL");
    expect((await (await decide(iam, id, "approved", "Yes, my report")).json()).data).toMatchObject({ status: "pending", approvalStage: 2 });

    // The manager is in the group too, but has already approved: another member decides.
    expect((await (await decide(iam, id, "approved")).json()).error.code).toBe("ALREADY_DECIDED");
    const waiting = (await (await ro.get("/api/v1/access/requests?view=waiting")).json()).data as { id: string }[];
    expect(waiting.some((w) => w.id === id)).toBe(true);
    expect((await (await decide(ro, id, "approved", "Data team agrees")).json()).data.status).toBe("approved");
    d = await detail(request, id);
    expect(d.steps.map((s) => s.status)).toEqual(["approved", "approved"]);
  });

  test("the same workflow on a second application; a risky request adds security, and a rejection mid-way closes it", async ({ request }) => {
    // Reuse: the ERP application's requests follow the same levels.
    const erp = await request.post("/api/v1/access/requests", { data: { applicationId: ids.app2, entitlementId: ids.reader2, subjectIdentityId: ids.s1, justification: "Month-end reporting" } });
    expect(erp.status(), await erp.text()).toBe(201);
    const erpId = (await erp.json()).data.id as string;
    expect(shape(await detail(request, erpId))).toEqual([
      [1, "manager", ids.iam, "pending"],
      [2, "group", ids.g1, "waiting"],
    ]);
    expect((await (await decide(iam, erpId, "rejected", "Not in their role")).json()).data.status).toBe("rejected");

    const risky = await request.post("/api/v1/access/requests", { data: { applicationId: ids.app1, entitlementId: ids.admin1, subjectIdentityId: ids.s2, justification: "CRM migration", durationDays: 7 } });
    expect(risky.status(), await risky.text()).toBe(201);
    const id = (await risky.json()).data.id as string;
    let d = await detail(request, id);
    expect(["high", "critical"]).toContain(d.request.riskLevel);
    expect(shape(d).map((s) => [s[0], s[1]])).toEqual([
      [1, "manager"],
      [2, "group"],
      [3, "access_managers"],
    ]);
    expect((await (await decide(iam, id, "approved")).json()).data).toMatchObject({ status: "pending", approvalStage: 2 });
    expect((await (await decide(ro, id, "rejected", "Admin access goes through the CAB")).json()).data.status).toBe("rejected");
    d = await detail(request, id);
    expect(d.request.status).toBe("rejected");
    expect(d.steps[2].status).not.toBe("approved");
  });

  test("an entitlement's own workflow: any one approver of the level decides, the others are skipped", async ({ request }) => {
    const res = await request.post("/api/v1/access/requests", { data: { applicationId: ids.app2, entitlementId: ids.viewer2, subjectIdentityId: ids.s3, justification: "Read-only ERP view" } });
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).data.id as string;
    // Steps of one level share a stage; their order within it does not matter.
    const byKind = (rows: unknown[][]) => rows.slice().sort((a, b) => String(a.length > 2 ? a[1] : a[0]).localeCompare(String(b.length > 2 ? b[1] : b[0])));
    expect(byKind(shape(await detail(request, id)))).toEqual([
      [1, "group", ids.g2, "pending"],
      [1, "named_approver", ids.readOnly, "pending"],
    ]);
    expect((await (await decide(iam, id, "approved")).json()).data.status).toBe("approved");
    const d = await detail(request, id);
    expect(byKind(d.steps.map((s) => [s.approverKind, s.status])).map((r) => r.join(":"))).toEqual(["group:approved", "named_approver:skipped"]);
    expect((await decide(ro, id, "approved")).status()).toBeGreaterThanOrEqual(400);
  });

  test("a changed workflow applies to new requests; one already waiting keeps its approvers", async ({ request }) => {
    const before = await request.post("/api/v1/access/requests", { data: { applicationId: ids.app1, entitlementId: ids.writer1, subjectIdentityId: ids.s3, justification: "Editing accounts" } });
    expect(before.status(), await before.text()).toBe(201);
    ids.waiting = (await before.json()).data.id;

    const patch = await request.patch(`/api/v1/access/approval-workflows/${ids.w1}`, { data: { levels: [{ name: "Data team", rule: "any", approvers: [{ kind: "group", groupId: ids.g1 }] }] } });
    expect(patch.status(), await patch.text()).toBe(200);
    expect((await patch.json()).data).toMatchObject({ version: 2 });
    expect((await iam.patch(`/api/v1/access/approval-workflows/${ids.w1}`, { data: { levels: [] } })).status()).toBe(400);

    const after = await request.post("/api/v1/access/requests", { data: { applicationId: ids.app1, entitlementId: ids.writer1, subjectIdentityId: ids.s4, justification: "Editing accounts" } });
    const afterId = (await after.json()).data.id as string;
    expect(shape(await detail(request, afterId))).toEqual([[1, "group", ids.g1, "pending"]]);
    expect(shape(await detail(request, ids.waiting))).toEqual([
      [1, "manager", ids.iam, "pending"],
      [2, "group", ids.g1, "waiting"],
    ]);
  });

  test("a workflow in use cannot be retired; a retired one cannot be chosen", async ({ request }) => {
    const inUse = await request.patch(`/api/v1/access/approval-workflows/${ids.w1}`, { data: { status: "retired" } });
    expect(inUse.status()).toBe(409);
    expect((await inUse.json()).error.code).toBe("WORKFLOW_IN_USE");
    expect((await request.patch(`/api/v1/access/approval-workflows/${ids.w3}`, { data: { status: "retired" } })).status()).toBe(200);
    const choose = await request.post("/api/v1/access/request-policies", { data: { applicationId: ids.app1, entitlementId: ids.reader1, name: `E2E Workflow retired ${stamp}`, approvalWorkflowId: ids.w3 } });
    expect(choose.status()).toBe(409);
    expect((await choose.json()).error.code).toBe("WORKFLOW_RETIRED");
  });

  test("the workflow pages show the levels and the policies using them; another organization sees and uses none", async ({ page, browser }) => {
    await page.goto("/access/approval-workflows");
    const table = page.getByRole("region", { name: "Approval workflows" });
    await expect(table).toContainText(`E2E Manager, data team, security ${stamp}`);
    await table.getByRole("link", { name: `E2E Manager, data team, security ${stamp}` }).click();
    await expect(page).toHaveURL(/\/access\/approval-workflows\/\d+$/);
    await expect(page.getByTestId("workflow-levels")).toContainText(`E2E Data Team ${stamp} (any member)`);
    await expect(page.getByTestId("workflow-policies")).toContainText(`E2E Workflow ERP ${stamp}`);

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect(((await (await two.request.get("/api/v1/access/approval-workflows")).json()).data as { id: string }[]).some((w) => w.id === ids.w1)).toBe(false);
    expect((await two.request.get(`/api/v1/access/approval-workflows/${ids.w1}`)).status()).toBe(404);
    expect((await two.request.patch(`/api/v1/access/approval-workflows/${ids.w1}`, { data: { name: "Taken over" } })).status()).toBe(404);
    const theirs = await two.request.post("/api/v1/access/request-policies", { data: { name: `E2E cross-org ${stamp}`, approvalWorkflowId: ids.w1 } });
    expect(theirs.status()).toBe(404);
    const p2 = await two.newPage();
    await p2.goto("/access/approval-workflows");
    await expect(p2.getByRole("heading", { name: "Approval workflows" })).toBeVisible();
    await expect(p2.getByText(`E2E Manager, data team, security ${stamp}`)).toHaveCount(0);
    await two.close();
  });
});

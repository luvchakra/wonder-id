import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { pendRequest } from "./pendingGrants";
import { toAccessRequest } from "./mappers";
import type { AccessRequest } from "@/lib/shared/types/access-governance";

/**
 * COMPLIANCE-P0-10 — Access's published contract for reviews of people's
 * access: the live grants a campaign covers, and the removal a reviewer's
 * revoke decision opens. Service-role reads and writes, every statement
 * filtered on the tenant the caller resolved (§14).
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviewableGrant = {
  grantId: string;
  accountId: string;
  accountRef: string;
  identityId: string;
  applicationId: string;
  applicationName: string;
  applicationOwnerIdentityId: string | null;
  /** COMPLIANCE-P0-15: the application's secondary (technical) owner, and the entitlement's own owner. */
  applicationTechnicalOwnerIdentityId: string | null;
  entitlementOwnerIdentityId: string | null;
  entitlementId: string;
  entitlementName: string;
  privilegeLevel: string;
};

/**
 * Access people hold (accounts linked to an identity, not an agent): not
 * revoked, not pending or merely marked done, still reported by the source.
 * COMPLIANCE-P0-15: optionally one entitlement or one person, and without
 * the access that comes from an access package (a review of the package
 * assignment covers it).
 */
export type GrantReviewFilter = { applicationId?: string | null; entitlementId?: string | null; identityId?: string | null; privilegedOnly?: boolean; excludePackageGrants?: boolean };
export async function listIdentityGrantsForReview(tenantId: string, filter: GrantReviewFilter = {}): Promise<ReviewableGrant[]> {
  for (const v of [filter.applicationId, filter.entitlementId, filter.identityId]) if (v && !UUID_RE.test(v)) return [];
  const admin = supabaseServiceRole();
  const out: ReviewableGrant[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin
      .from("access_grants")
      .select(
        "id, tenant_id, account_id, entitlement_id, accounts!inner(id, tenant_id, identity_id, agent_id, application_id, external_account_ref, status), entitlements!inner(id, name, privilege_level, application_id, owner_identity_id, applications!inner(id, name, display_name, business_owner_identity_id, technical_owner_identity_id))",
      )
      .eq("tenant_id", tenantId)
      .is("revoked_at", null)
      .is("missing_from_source_at", null)
      .in("fulfilment_status", ["none", "verified"])
      .not("accounts.identity_id", "is", null)
      .is("accounts.agent_id", null)
      .neq("accounts.status", "pending");
    if (filter.applicationId) q = q.eq("entitlements.application_id", filter.applicationId);
    if (filter.privilegedOnly) q = q.in("entitlements.privilege_level", ["elevated", "admin"]);
    if (filter.entitlementId) q = q.eq("entitlement_id", filter.entitlementId);
    if (filter.identityId) q = q.eq("accounts.identity_id", filter.identityId);
    if (filter.excludePackageGrants) q = q.is("access_package_assignment_item_id", null);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    for (const r of (data ?? []) as Row[]) {
      const account = r.accounts as unknown as Row;
      const ent = r.entitlements as unknown as Row;
      const app = ent.applications as unknown as Row;
      if (r.tenant_id !== tenantId || account.tenant_id !== tenantId) continue;
      out.push({
        grantId: r.id as string,
        accountId: account.id as string,
        accountRef: account.external_account_ref as string,
        identityId: account.identity_id as string,
        applicationId: app.id as string,
        applicationName: ((app.display_name as string | null) || (app.name as string)) ?? "",
        applicationOwnerIdentityId: (app.business_owner_identity_id as string | null) ?? null,
        applicationTechnicalOwnerIdentityId: (app.technical_owner_identity_id as string | null) ?? null,
        entitlementOwnerIdentityId: (ent.owner_identity_id as string | null) ?? null,
        entitlementId: ent.id as string,
        entitlementName: ent.name as string,
        privilegeLevel: ent.privilege_level as string,
      });
    }
    if ((data ?? []).length < 1000 || out.length >= 20_000) break;
  }
  return out;
}

export type ReviewableMembership = {
  assignmentId: string;
  identityId: string;
  packageId: string;
  packageRef: number | null;
  packageName: string;
  ownerIdentityId: string | null;
  birthright: boolean;
  source: string;
  expiresAt: string | null;
  resources: number;
  /** An application the package gives access to, when the review is about one application. */
  applicationIds: string[];
};

/**
 * COMPLIANCE-P0-15: live assignments of business roles (access packages)
 * to people: for one package, one person, or the packages that include one
 * application. Service role, filtered by tenant (§14).
 */
export async function listPackageAssignmentsForReview(tenantId: string, filter: { packageId?: string | null; identityId?: string | null; applicationId?: string | null }): Promise<ReviewableMembership[]> {
  for (const v of [filter.packageId, filter.identityId, filter.applicationId]) if (v && !UUID_RE.test(v)) return [];
  const admin = supabaseServiceRole();
  let q = admin
    .from("access_package_assignments")
    .select("id, tenant_id, identity_id, package_id, source, expires_at, access_packages!inner(id, tenant_id, ref, name, owner_identity_id, birthright_status, access_package_resources(application_id))")
    .eq("tenant_id", tenantId)
    .in("status", ["provisioning", "active", "partially_failed"]);
  if (filter.packageId) q = q.eq("package_id", filter.packageId);
  if (filter.identityId) q = q.eq("identity_id", filter.identityId);
  const { data, error } = await q.order("id").limit(20_000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const out: ReviewableMembership[] = [];
  for (const r of (data ?? []) as Row[]) {
    const pkg = r.access_packages as unknown as Row;
    if (r.tenant_id !== tenantId || pkg.tenant_id !== tenantId) continue;
    const applicationIds = [...new Set(((pkg.access_package_resources as Row[] | null) ?? []).map((x) => x.application_id as string).filter(Boolean))];
    if (filter.applicationId && !applicationIds.includes(filter.applicationId)) continue;
    out.push({
      assignmentId: r.id as string,
      identityId: r.identity_id as string,
      packageId: pkg.id as string,
      packageRef: (pkg.ref as number | null) ?? null,
      packageName: pkg.name as string,
      ownerIdentityId: (pkg.owner_identity_id as string | null) ?? null,
      birthright: pkg.birthright_status === "on",
      source: r.source as string,
      expiresAt: (r.expires_at as string | null) ?? null,
      resources: ((pkg.access_package_resources as Row[] | null) ?? []).length,
      applicationIds,
    });
  }
  return out;
}

/**
 * A reviewer's revoke decision on a person's access: the decision is the
 * human approval (#15), so the removal request is approved as it is opened
 * and then followed like any other (a fulfilment task or the connection,
 * verified at the source). An open removal for the same access is reused.
 */
export async function requestCertifiedRemoval(tenantId: string, actorId: string, input: { grantId: string; certificationItemId: string; justification: string }): Promise<AccessRequest> {
  if (!UUID_RE.test(input.grantId)) throw new ApiError(404, "NOT_FOUND", "No such access");
  const admin = supabaseServiceRole();
  const { data: grant, error } = await admin
    .from("access_grants")
    .select("id, tenant_id, revoked_at, entitlement_id, accounts!inner(tenant_id, identity_id, agent_id, application_id)")
    .eq("tenant_id", tenantId)
    .eq("id", input.grantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const account = grant?.accounts as unknown as Row | undefined;
  if (!grant || grant.tenant_id !== tenantId || !account || account.tenant_id !== tenantId || !account.identity_id) throw new ApiError(404, "NOT_FOUND", "No such access");
  if (grant.revoked_at) throw new ApiError(409, "ALREADY_REMOVED", "This access was already removed");

  const subjectIdentityId = account.identity_id as string;
  const applicationId = account.application_id as string;
  const entitlementId = grant.entitlement_id as string;
  const { data: open } = await admin
    .from("access_requests")
    .select()
    .eq("tenant_id", tenantId)
    .eq("subject_identity_id", subjectIdentityId)
    .eq("application_id", applicationId)
    .eq("entitlement_id", entitlementId)
    .eq("request_type", "remove")
    .in("status", ["pending", "approved"])
    .limit(1)
    .maybeSingle();
  if (open) return toAccessRequest(open);

  const reviewer = await getIdentityForUser(tenantId, actorId);
  const now = new Date().toISOString();
  const { data, error: insertError } = await admin
    .from("access_requests")
    .insert({
      tenant_id: tenantId,
      subject_identity_id: subjectIdentityId,
      requester_identity_id: reviewer?.id ?? null,
      requested_by: actorId,
      application_id: applicationId,
      entitlement_id: entitlementId,
      request_type: "remove",
      justification: input.justification.trim().slice(0, 2000) || "Revoked in an access review",
      status: "approved",
      decided_by: actorId,
      decided_at: now,
      risk_level: "low",
      policy_result: { checks: [{ check: "certification", result: `revoked in access review item ${input.certificationItemId}` }] },
    })
    .select()
    .single();
  if (insertError || !data) throw new ApiError(insertError?.code === "23505" ? 409 : 500, insertError?.code === "23505" ? "ANOTHER_REQUEST_WAITING" : "CREATE_FAILED", insertError?.message ?? "Could not open the removal");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.certified_removal_requested",
    objectType: "access_request",
    objectId: data.id as string,
    outcome: "success",
    metadata: { subjectIdentityId, applicationId, entitlementId, grantId: input.grantId, certificationItemId: input.certificationItemId },
  });
  // Opens the removal task (or sends it through the connection) like any approved removal.
  await pendRequest(tenantId, data.id as string);
  return toAccessRequest(data);
}

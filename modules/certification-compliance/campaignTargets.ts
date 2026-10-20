import "server-only";

import { listEntitlementInventory, listIdentityGrantsForReview, listLiveApplications, listPackagesForReview } from "@/modules/access-governance/service";
import { listIdentities } from "@/modules/agent-identity/service";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";

/**
 * COMPLIANCE-P0-15 — what the campaign-type form offers: the live
 * applications, the active business roles and the members who can be the
 * fallback reviewer, plus a search over entitlements and people, and the
 * access one person holds (for a micro-certification). Read through the
 * owning modules' published services, filtered by the caller's tenant;
 * every list is bounded (§15.1 rule 6).
 */
export type CampaignTargets = {
  applications: { id: string; name: string }[];
  packages: { id: string; name: string; birthright: boolean }[];
  members: { userId: string; name: string }[];
};

export async function listCampaignTargets(tenantId: string): Promise<CampaignTargets> {
  const [applications, packages, members] = await Promise.all([listLiveApplications(tenantId), listPackagesForReview(tenantId), listTenantMembersWithRoles(tenantId)]);
  return {
    applications,
    packages: packages.slice(0, 500).map((p) => ({ id: p.id, name: p.name, birthright: p.birthright })),
    members: members
      .map((m) => ({ userId: m.userId, name: m.displayName ? `${m.displayName} (${m.email})` : m.email }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 500),
  };
}

/** Up to 20 entitlements whose name matches, with their application. */
export async function searchEntitlementTargets(tenantId: string, q: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await listEntitlementInventory(tenantId, { q, pageSize: 20 });
  return rows.map((e) => ({ id: e.id, name: `${e.applicationDisplayName || e.applicationName} · ${e.name}` }));
}

/** Up to 20 people (human or external) whose name or email matches. */
export async function searchPeopleTargets(tenantId: string, q: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await listIdentities(tenantId, { types: ["HUMAN", "EXTERNAL"], q, pageSize: 20 });
  return rows.map((p) => ({ id: p.id, name: p.email ? `${p.displayName} (${p.email})` : p.displayName }));
}

/** The entitlements one person holds today, for a micro-certification. */
export async function listPersonAccessForReview(tenantId: string, identityId: string): Promise<{ id: string; name: string }[]> {
  const grants = await listIdentityGrantsForReview(tenantId, { identityId });
  const seen = new Map<string, string>();
  for (const g of grants) if (!seen.has(g.entitlementId)) seen.set(g.entitlementId, `${g.applicationName} · ${g.entitlementName}`);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

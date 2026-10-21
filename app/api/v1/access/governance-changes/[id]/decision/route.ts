import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { decideGovernanceChange } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";
import { TENANT_ADMIN_ROLE } from "@/lib/rbac/delegatedRoleRules";

/** `{ decision: "approved" | "rejected", note? }` — not by the person who proposed it, except a Tenant Administrator approving with a note (owner decision, 2026-10-21). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await decideGovernanceChange(ctx.tenantId!, ctx.userId, id, body.decision, body.note, ctx.roles.includes(TENANT_ADMIN_ROLE)) });
  } catch (err) {
    return errorResponse(err);
  }
}

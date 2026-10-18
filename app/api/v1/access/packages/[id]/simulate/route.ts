import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { simulatePackageChange } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-21 — what adding or removing this role would do to one
 * identity's access. Changes nothing. `{ identityId, action: "add" | "remove" }`
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { identityId?: unknown; action?: unknown };
    const action = body.action === "remove" ? "remove" : "add";
    return NextResponse.json({ ok: true, data: await simulatePackageChange(ctx.tenantId!, id, typeof body.identityId === "string" ? body.identityId : "", action) });
  } catch (err) {
    return errorResponse(err);
  }
}

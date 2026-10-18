import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { removePackageInclude } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-21 — stops including a role or package. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; includedId: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id, includedId } = await params;
    await removePackageInclude(ctx.tenantId!, ctx.userId, id, includedId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

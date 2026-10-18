import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { addPackageInclude } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-21 — a role includes another active role or package. `{ includedPackageId }` */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { includedPackageId?: unknown };
    await addPackageInclude(ctx.tenantId!, ctx.userId, id, body.includedPackageId);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

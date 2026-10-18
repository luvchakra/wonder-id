import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getApprovalWorkflow, updateApprovalWorkflow } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// One approval workflow with the policies that use it; PATCH changes its
// name, description, levels or status as its next version (access.manage).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const w = await getApprovalWorkflow(ctx.tenantId!, (await params).id);
    if (!w) throw new ApiError(404, "NOT_FOUND", "No such approval workflow");
    return NextResponse.json({ ok: true, data: w });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await updateApprovalWorkflow(ctx.tenantId!, ctx.userId, (await params).id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}

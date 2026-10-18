import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createApprovalWorkflow, listApprovalWorkflows } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// Approval workflows: reusable approval patterns with several levels. GET
// lists them; POST creates one (access.manage).
export async function GET() {
  try {
    const ctx = await requirePermission("access.read");
    return NextResponse.json({ ok: true, data: await listApprovalWorkflows(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.manage");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await createApprovalWorkflow(ctx.tenantId!, ctx.userId, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

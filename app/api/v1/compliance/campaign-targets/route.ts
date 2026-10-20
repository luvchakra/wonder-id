import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaignTargets, listPersonAccessForReview, searchEntitlementTargets, searchPeopleTargets } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/**
 * COMPLIANCE-P0-15: the choices of the campaign-type form (compliance.manage,
 * like launching). `?entitlements=` and `?people=` search; `?accessOf=` lists
 * one person's entitlements; nothing else returns the fixed lists.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const url = new URL(request.url);
    const term = (k: string) => (url.searchParams.get(k) ?? "").trim().slice(0, 100);
    if (url.searchParams.has("entitlements")) return NextResponse.json({ ok: true, data: await searchEntitlementTargets(ctx.tenantId!, term("entitlements")) });
    if (url.searchParams.has("people")) return NextResponse.json({ ok: true, data: await searchPeopleTargets(ctx.tenantId!, term("people")) });
    if (url.searchParams.has("accessOf")) return NextResponse.json({ ok: true, data: await listPersonAccessForReview(ctx.tenantId!, term("accessOf")) });
    return NextResponse.json({ ok: true, data: await listCampaignTargets(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

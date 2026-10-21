"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { CAREERS_KEY_PATTERN, removeCareersConnection, saveCareersConnection } from "@/modules/platform-admin/service";
import { checkCareersKey } from "@/modules/careers/wonderjobs";

/**
 * The careers connection in the vendor console (owner request, 2026-10-21):
 * a platform administrator pastes the WonderJobs career-site key here, so a
 * new or rotated key works at once, with no deployment. The key is checked
 * against WonderJobs before it is saved, stored encrypted, and never sent
 * back to the browser; every change is in the platform audit log.
 */

export type CareersConnectionState = { ok: boolean; message: string | null };

function refreshCareers() {
  // The careers pages cache WonderJobs' answers for five minutes; a new key applies now.
  revalidateTag("careers", { expire: 0 });
  revalidatePath("/careers", "layout");
  revalidatePath("/welcome");
  revalidatePath("/platform-admin/careers");
}

export async function saveCareersConnectionAction(_prev: CareersConnectionState, form: FormData): Promise<CareersConnectionState> {
  const { userId } = await requirePlatformAdmin();
  const key = String(form.get("key") ?? "").trim();
  const baseUrl = String(form.get("baseUrl") ?? "").trim().replace(/\/+$/, "") || null;
  if (!CAREERS_KEY_PATTERN.test(key)) return { ok: false, message: "That isn't a career site key. It starts with wjcs_ and is shown once in WonderJobs → Hiring → Jobs → Career sites." };
  const check = await checkCareersKey(key, baseUrl);
  if (check.state === "bad_address") return { ok: false, message: "The WonderJobs address must be an https address on wonderapps.biz." };
  if (check.state === "rejected") return { ok: false, message: "WonderJobs didn't accept this key. It may be mistyped or revoked; add a new one in WonderJobs and paste it here." };
  if (check.state === "unavailable") return { ok: false, message: "WonderJobs couldn't be reached, so the key wasn't saved. Try again in a minute." };
  try {
    await saveCareersConnection(userId, key, baseUrl);
  } catch {
    return { ok: false, message: "The key was accepted by WonderJobs but couldn't be saved. Try again." };
  }
  refreshCareers();
  return { ok: true, message: `Connected to ${check.site}. ${check.jobs === 1 ? "1 position is" : `${check.jobs} positions are`} live on the careers page now.` };
}

export async function removeCareersConnectionAction(): Promise<CareersConnectionState> {
  const { userId } = await requirePlatformAdmin();
  try {
    await removeCareersConnection(userId);
  } catch {
    return { ok: false, message: "The key couldn't be removed. Try again." };
  }
  refreshCareers();
  return { ok: true, message: "Key removed." };
}

/** Re-reads WonderJobs now instead of within five minutes (after posting or linking jobs there). */
export async function refreshCareersAction(): Promise<void> {
  await requirePlatformAdmin();
  refreshCareers();
}

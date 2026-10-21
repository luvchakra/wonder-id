// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePlatformAdmin = vi.fn(async () => ({ userId: "admin-1" }));
const saveCareersConnection = vi.fn(async () => undefined);
const removeCareersConnection = vi.fn(async () => undefined);
const checkCareersKey = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/rbac/requirePlatformAdmin", () => ({ requirePlatformAdmin: () => requirePlatformAdmin() }));
vi.mock("@/modules/platform-admin/service", () => ({
  CAREERS_KEY_PATTERN: /^wjcs_[A-Za-z0-9_-]{20,120}$/,
  saveCareersConnection: (...a: unknown[]) => saveCareersConnection(...(a as [])),
  removeCareersConnection: (...a: unknown[]) => removeCareersConnection(...(a as [])),
}));
vi.mock("@/modules/careers/wonderjobs", () => ({ checkCareersKey: (...a: unknown[]) => checkCareersKey(...a) }));

import { refreshCareersAction, removeCareersConnectionAction, saveCareersConnectionAction } from "./platformCareers";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const KEY = "wjcs_" + "a".repeat(32);
const idle = { ok: false, message: null };

beforeEach(() => {
  vi.clearAllMocks();
  requirePlatformAdmin.mockImplementation(async () => ({ userId: "admin-1" }));
});

describe("the careers connection in the vendor console", () => {
  it("is for platform administrators only", async () => {
    requirePlatformAdmin.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(saveCareersConnectionAction(idle, form({ key: KEY }))).rejects.toThrow("FORBIDDEN");
    requirePlatformAdmin.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(removeCareersConnectionAction()).rejects.toThrow("FORBIDDEN");
    requirePlatformAdmin.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(refreshCareersAction()).rejects.toThrow("FORBIDDEN");
    expect(saveCareersConnection).not.toHaveBeenCalled();
    expect(removeCareersConnection).not.toHaveBeenCalled();
  });

  it("refuses something that isn't a career site key without calling WonderJobs", async () => {
    const r = await saveCareersConnectionAction(idle, form({ key: "sk-not-a-key" }));
    expect(r.ok).toBe(false);
    expect(checkCareersKey).not.toHaveBeenCalled();
  });

  it("saves only a key WonderJobs accepts", async () => {
    checkCareersKey.mockResolvedValueOnce({ state: "rejected" });
    expect((await saveCareersConnectionAction(idle, form({ key: KEY }))).ok).toBe(false);
    checkCareersKey.mockResolvedValueOnce({ state: "unavailable" });
    expect((await saveCareersConnectionAction(idle, form({ key: KEY }))).message).toMatch(/wasn't saved/);
    expect(saveCareersConnection).not.toHaveBeenCalled();

    checkCareersKey.mockResolvedValueOnce({ state: "ok", site: "WonderID careers", jobs: 4 });
    const r = await saveCareersConnectionAction(idle, form({ key: ` ${KEY} `, baseUrl: "https://jobs.wonderapps.biz/" }));
    expect(r).toEqual({ ok: true, message: "Connected to WonderID careers. 4 positions are live on the careers page now." });
    expect(saveCareersConnection).toHaveBeenCalledWith("admin-1", KEY, "https://jobs.wonderapps.biz");
  });

  it("never returns the key in its answer", async () => {
    checkCareersKey.mockResolvedValueOnce({ state: "ok", site: "WonderID careers", jobs: 1 });
    expect(JSON.stringify(await saveCareersConnectionAction(idle, form({ key: KEY })))).not.toContain(KEY);
  });
});

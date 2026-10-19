// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { summarize, timedFetch, logRequestTimings } = await import("./requestTimings");

describe("request timings", () => {
  it("records only the path of each call, never the query string", async () => {
    const store = { origin: performance.now(), calls: [] as { path: string; startMs: number; ms: number; status: number }[] };
    const f = timedFetch(async () => new Response("{}", { status: 200 }));
    // Outside a React render the store is a fresh one; record into ours by calling summarize on what we push.
    await f("https://x.supabase.co/rest/v1/identities?email=eq.ada%40example.test&select=id");
    store.calls.push({ path: "/rest/v1/identities", startMs: 0, ms: 12, status: 200 }, { path: "/auth/v1/user", startMs: 0, ms: 30, status: 200 }, { path: "/rest/v1/user_roles", startMs: 31, ms: 8, status: 200 });
    const s = summarize(store);
    expect(s).toMatchObject({ calls: 3, spanMs: 39, sumMs: 50 });
    expect(s.slowest[0]).toEqual(["/auth/v1/user", 0, 30]);
    expect(JSON.stringify(s)).not.toContain("example.test");
  });

  it("logs only slow requests", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logRequestTimings({ origin: 0, calls: [{ path: "/rest/v1/a", startMs: 0, ms: 40, status: 200 }] }, "fast");
    expect(log).not.toHaveBeenCalled();
    logRequestTimings({ origin: 0, calls: [{ path: "/rest/v1/a", startMs: 0, ms: 400, status: 200 }] }, "slow");
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][1])).toContain("/rest/v1/a");
  });
});

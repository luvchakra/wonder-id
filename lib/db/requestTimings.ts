import "server-only";

import { cache } from "react";

/**
 * Performance review (2026-10-19): every Supabase call a request makes, with
 * when it started and how long it took, so the slow page renders can be read
 * from the production logs instead of guessed. One log line per slow request,
 * written after the response is sent (`logRequestTimings` in an `after()`).
 *
 * Only the API path is kept (e.g. `/rest/v1/user_roles`, `/auth/v1/user`):
 * never the query string, which can carry ids or e-mail addresses, never a
 * body or a header (CLAUDE.md §17.7, #10).
 */
type Call = { path: string; startMs: number; ms: number; status: number };
type Store = { origin: number; calls: Call[] };

/** The request's store: one per React render (pages and layouts); outside one, a fresh store nobody reads. */
export const requestTimings = cache((): Store => ({ origin: performance.now(), calls: [] }));

function store(): Store | null {
  try {
    return requestTimings();
  } catch {
    return null;
  }
}

/** Wraps a fetch so each call is recorded in the request's store. */
export function timedFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const s = store();
    const start = performance.now();
    let status = 0;
    try {
      const res = await inner(input, init);
      status = res.status;
      return res;
    } finally {
      if (s) s.calls.push({ path: pathOf(input), startMs: Math.round(start - s.origin), ms: Math.round(performance.now() - start), status });
    }
  };
}

function pathOf(input: Parameters<typeof fetch>[0]): string {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).pathname;
  } catch {
    return "unknown";
  }
}

/** The slowest-first summary of a store, for the log line (exported for its unit test). */
export function summarize(s: Store): { calls: number; spanMs: number; sumMs: number; slowest: [string, number, number][] } {
  const end = Math.max(0, ...s.calls.map((c) => c.startMs + c.ms));
  return {
    calls: s.calls.length,
    spanMs: end,
    sumMs: s.calls.reduce((a, c) => a + c.ms, 0),
    slowest: [...s.calls].sort((a, b) => b.ms - a.ms).slice(0, 12).map((c) => [c.path, c.startMs, c.ms]),
  };
}

/** Logs the request's Supabase calls when they spanned longer than `thresholdMs`. */
export function logRequestTimings(s: Store, label: string, thresholdMs = 250): void {
  const summary = summarize(s);
  if (summary.spanMs < thresholdMs) return;
  console.log("[perf] supabase", JSON.stringify({ label, ...summary }));
}

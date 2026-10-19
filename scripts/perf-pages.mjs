// Performance review (2026-10-19): times key pages and API calls on a live
// deployment, signed in, so a change's effect is measured, not assumed
// (CLAUDE.md §15). Read-only: it only signs in and loads pages.
//
//   node scripts/perf-pages.mjs                       # production, E2E Tenant One
//   BASE=https://<slug>.id.wonderapps.biz ROUTES=/,/access/requests RUNS=5 node scripts/perf-pages.mjs
//
// PERF_EMAIL / PERF_PASSWORD default to the E2E administrator (tests/e2e/support/testUsers.ts).
// Prints, per route, the median time until the server finished the HTML
// (serverHtmlMs: what our code controls) and until the page loaded.
import { chromium } from "playwright";

const BASE = process.env.BASE || "https://e2e-tenant-one.id.wonderapps.biz";
const ROUTES = (process.env.ROUTES || "/,/access/catalog,/access/requests,/access/packages,/access/entitlements,/access/request-policies,/access,/agents,/identities,/risk,/risk/rogue-accounts,/compliance/campaigns,/audit,/integrations,/settings/users,/policies,/controls,/reports").split(",");
const RUNS = Number(process.env.RUNS || 3);
const EMAIL = process.env.PERF_EMAIL || "e2e-admin-1@e2e.wonderagent.test";
const PASSWORD = process.env.PERF_PASSWORD || "E2E-Test-Passw0rd!1";

const browser = await chromium.launch(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {});
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/sign-in`);
await page.waitForTimeout(2500); // let the form hydrate
await page.getByLabel("Email").fill(EMAIL);
await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60_000 });

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rows = [];
for (const route of ROUTES) {
  const html = [];
  const load = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    await page.goto(BASE + route, { waitUntil: "load", timeout: 90_000 });
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return n.responseEnd - n.requestStart;
    });
    html.push(Math.round(t));
    load.push(Date.now() - t0);
  }
  rows.push({ route, serverHtmlMs: median(html), loadMs: median(load), landedOn: new URL(page.url()).pathname });
  console.log(JSON.stringify(rows.at(-1)));
}
const all = rows.map((r) => r.serverHtmlMs);
console.log(JSON.stringify({ routes: rows.length, medianServerHtmlMs: median(all) }));
await browser.close();

#!/usr/bin/env node
/**
 * Cheap UI check (CLAUDE.md §20 "Text before pixels").
 *
 * Opens a path, optionally clicks elements, and prints each matched element's
 * text and box, one line each. With --shot, saves one cropped JPEG (quality 60)
 * around the matched elements.
 *
 * Usage:
 *   node scripts/ui-check.mjs <path> [--find role:name]... [--click role:name]...
 *     [--shot out.jpg] [--base http://localhost:3000] [--width 1280]
 *
 * role:name uses Playwright's getByRole (case-insensitive substring name match).
 * Example:
 *   node scripts/ui-check.mjs /access/requests --find heading: --find button:Create
 *
 * Exit code 1 when a role:name matches nothing or a page error is thrown.
 */
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opts = { path: "/", finds: [], clicks: [], shot: null, base: process.env.UI_CHECK_BASE_URL ?? "http://localhost:3000", width: 1280 };

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--find") opts.finds.push(args[++i]);
  else if (a === "--click") opts.clicks.push(args[++i]);
  else if (a === "--shot") opts.shot = args[++i];
  else if (a === "--base") opts.base = args[++i];
  else if (a === "--width") opts.width = Number(args[++i]);
  else opts.path = a;
}

function parseRole(spec) {
  const at = spec.indexOf(":");
  const role = at === -1 ? spec : spec.slice(0, at);
  const name = at === -1 ? undefined : spec.slice(at + 1);
  return name ? { role, name } : { role };
}

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: opts.width, height: 800 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

let failed = false;
const boxes = [];

async function report(tag, locator, label) {
  const count = await locator.count();
  if (count === 0) {
    console.log(`[${tag}] no match for ${label}`);
    failed = true;
    return null;
  }
  const el = locator.first();
  const box = await el.boundingBox();
  const text = clean(await el.innerText().catch(() => ""));
  const b = box ? `x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)} h=${Math.round(box.height)}` : "hidden";
  console.log(`[${tag}] ${label} (${count} match${count === 1 ? "" : "es"}) "${text}" ${b}`);
  if (box) boxes.push(box);
  return box;
}

try {
  await page.goto(new URL(opts.path, opts.base).toString(), { waitUntil: "networkidle" }).catch(() => {});
  console.log(`[page] ${page.url()} title="${clean(await page.title())}"`);

  for (const spec of opts.finds) {
    const { role, name } = parseRole(spec);
    await report("find", page.getByRole(role, name ? { name } : {}), spec);
  }

  for (const spec of opts.clicks) {
    const { role, name } = parseRole(spec);
    const locator = page.getByRole(role, name ? { name } : {});
    const box = await report("click", locator, spec);
    if (box) {
      await locator.first().click();
      await page.waitForLoadState("networkidle").catch(() => {});
      console.log(`[after] ${spec} -> ${new URL(page.url()).pathname}`);
    }
  }

  if (opts.shot && boxes.length > 0) {
    const minX = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 8);
    const minY = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 8);
    const maxX = Math.max(...boxes.map((b) => b.x + b.width)) + 8;
    const maxY = Math.max(...boxes.map((b) => b.y + b.height)) + 8;
    await page.screenshot({
      path: opts.shot,
      type: "jpeg",
      quality: 60,
      clip: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    });
    console.log(`[shot] ${opts.shot}`);
  }
} catch (err) {
  console.log(`[error] ${clean(String(err.message ?? err))}`);
  failed = true;
} finally {
  if (consoleErrors.length > 0) {
    console.log(`[errors] ${consoleErrors.length} console/page error(s); first: "${clean(consoleErrors[0])}"`);
  }
  await browser.close();
}

process.exit(failed ? 1 : 0);

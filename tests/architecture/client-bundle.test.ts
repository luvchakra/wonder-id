import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * AI reverse-engineering hardening (owner request 2026-10-21): the logic
 * that is the product's real value — risk scoring and rogue-agent rules,
 * SHOULD/CAN/DID runtime comparison, the authorization engine and the AI
 * prompts — runs on the server only and never ships in a browser bundle,
 * where anyone (or any AI model) could read it.
 *
 * Walks every "use client" file's imports, following value imports (not
 * `import type`, which leaves no code in the bundle) through the source
 * tree, and fails if one reaches a server-only area below. A "use server"
 * file is a boundary: the client receives only a reference to its actions.
 */

const ROOT = join(__dirname, "..", "..");

const SERVER_ONLY_AREAS = [
  "modules/risk/",
  "modules/runtime-assurance/",
  "lib/rbac/",
  "lib/ai/",
];

const SOURCE_DIRS = ["app", "modules", "lib"];
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split("\\").join("/");
const source = new Map<string, string>();
const read = (p: string) => {
  if (!source.has(p)) source.set(p, readFileSync(p, "utf8"));
  return source.get(p)!;
};

const directive = (text: string, name: string) => new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${name}["']`).test(text);

/** Value imports and re-exports of one file, resolved to source files. */
function valueImports(file: string): string[] {
  const text = read(file);
  const specs: string[] = [];
  const re = /(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of text.matchAll(re)) {
    if (m[1]) continue;
    specs.push(m[2]);
  }
  // Dynamic imports load code; `x: import("…").T` in a type position does not.
  for (const m of text.matchAll(/(?<![:<|&,]\s*)\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  const out: string[] = [];
  for (const spec of specs) {
    let base: string | null = null;
    if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(file), spec);
    if (!base) continue;
    const hit = [base, ...EXTENSIONS.map((e) => base + e)].find((p) => existsSync(p) && statSync(p).isFile());
    if (hit) out.push(hit);
  }
  return out;
}

describe("client bundles carry no server-only logic", () => {
  const clientFiles = SOURCE_DIRS.flatMap((d) => files(join(ROOT, d))).filter((f) => directive(read(f), "use client"));

  it("finds the client components to check", () => {
    expect(clientFiles.length).toBeGreaterThan(20);
  });

  it("no client file reaches the risk, runtime, authorization or AI code", () => {
    const violations: string[] = [];
    for (const start of clientFiles) {
      const seen = new Set<string>([start]);
      const queue: { file: string; path: string[] }[] = [{ file: start, path: [rel(start)] }];
      while (queue.length) {
        const { file, path } = queue.shift()!;
        for (const next of valueImports(file)) {
          if (seen.has(next)) continue;
          seen.add(next);
          const r = rel(next);
          if (directive(read(next), "use server")) continue;
          if (SERVER_ONLY_AREAS.some((a) => r.startsWith(a))) {
            violations.push([...path, r].join(" -> "));
            continue;
          }
          queue.push({ file: next, path: [...path, r] });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

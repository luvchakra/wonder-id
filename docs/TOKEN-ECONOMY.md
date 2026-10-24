# Token economy

Record for CLAUDE.md §20. Dated 2026-10-24.

Context is re-read on every turn, so cost is roughly context size × turns. This file holds
the measurements behind the CLAUDE.md rewrite and the rules changed in it.

## CLAUDE.md before and after

| Measure | Before | After | Saved |
|---|---|---|---|
| Bytes | 101,361 | 60,743 | 40.1% |
| Words | 14,219 | 8,788 | 38.2% |
| Lines | 1,709 | 492 | 71.2% |
| Approx. tokens (bytes ÷ 4) | ~25,300 | ~15,200 | ~40% |

The token figure is an estimate from bytes. No tokenizer was run.

## Other files loaded into every session

- Only `CLAUDE.md` at the repository root. No `AGENTS.md`, no nested `CLAUDE.md`, no `.claude/` settings in the repo, no `@` imports.
- Not measured: the harness system prompt and tool schemas. Deferred MCP tools (the Vercel server has 200+) load only through ToolSearch, so keep it that way.

## Measured usage

Only one transcript exists on this machine: the current session, `~/.claude/projects/-home-user-wonder-id/*.jsonl`, at 3 assistant turns.

- Usage sums: input 6; cache read 255,569; cache creation 65,749; output 2,292.
- Average context per turn: about 107,100 tokens (peak 110,300).
- Largest tool results: 565 and 291 bytes (two results in total).

Three turns are too few to show a trend. Treat these as a baseline. Re-measure after a few sessions with the same sums.

## Biggest token sinks found

1. **CLAUDE.md, re-read every turn:** 101 KB, about 25k tokens, roughly a quarter of the 107k average context. Fixed by this change.
2. **Module audit logs:** 11 files, 1.57 MB in total, the largest 259 KB. Read whole, one would cost about 65k tokens. Read by tail only (CLAUDE.md §0, §20).
3. **Other large text that agents tend to read whole:** `docs/WonderID/reference/WONDERID-FOUNDATION-DESIGN.md` (135 KB), `docs/WonderID/HIGH-RISK-FINDINGS.md` (125 KB), `modules/integrations/framework/contract.test.ts` (115 KB), `modules/ui/help/content.ts` (105 KB), `docs/WonderID/KNOWLEDGE-BASE.md` (86 KB), `docs/requirements/WonderID_P0_Implementation_Spec_v3.md` (184 KB), `package-lock.json` (411 KB). Listed in CLAUDE.md §20 as never-read-whole.
4. **Images:** `docs/requirements/*.png` totals 13.5 MB and `assets/product/*.png` 3.9 MB. Each image Read costs image tokens. CLAUDE.md §20 limits screenshots.
5. **Test output and traces:** not sampled here. CLAUDE.md §20 says to read only error summaries.

## Rules added

- CLAUDE.md §0 item 5 (pointer) and §20 (Token Economy): short sessions, batching, one CI read per CI event, text before pixels, narrow reads, quiet output, short replies.
- `scripts/ui-check.mjs`: prints each matched element's text and box, clicks by role and name, and with `--shot` saves one cropped JPEG at quality 60. Tested against a local page: find, click, screenshot, and exit code 1 on a missing match.

## Rules changed or dropped, on purpose

Every non-negotiable (§1 #1–#20), every locked-architecture fact (§2), and every section number is kept. Code and docs cite CLAUDE.md sections about 120 times, so numbering did not change.

**Changed:**

1. **§19.9 rule 3** said the nightly suite is "three (one per part)". §19.8 and §19.9 rule 0 say four parts. The text now reads four a night, one per part, to match the schedule.
2. **§20 full-suite rule** now reads "never the full suite, unless asked or §17.8 requires it". Without the qualifier it contradicted §17.8, which requires the full Playwright suite after certain changes.
3. **§19.6 roadmap paths** are written from the repository root (`docs/WonderID/run-order/RUN-ORDER.md`, `docs/WonderID/progress/PROGRESS.md`). They were relative before.
4. **§19.10 and §19.11** now appear in numeric order (they were 19.11, then 19.10). Their numbers did not change.
5. **"Timestamp every message"** moved from §19.7 to §0 item 4, because it applies to every session. The rule is the same.
6. **Sync instructions** appeared in §4 and §19.1. They now live only in §0; §4 and §19.1 point there.
7. **§2 WonderID extensions** became a table column, and the §5 repository tree is shorter. The 11 backlog files are summarized as `NN-*-BACKLOG.md`.

**Moved out, with a pointer left behind:**

- The navigation specification (areas, Administration list, icon and flyout rules, collapse, search, footer) moved to `docs/design/shell-navigation.md`. The binding rules stay in CLAUDE.md §13.
- The 2026-10-01 analysis narrative moved to `docs/security/FINANCE-PRIVACY-ANALYSIS-2026-10-01.md`. The decisions and open items stay in CLAUDE.md §18.1.

**Dropped:** background stories and "why" asides; the history lines (for example the 2026-10-15 "done" status under §19.13, and the "pre-launch, adjust after launch" heading in §19.6). Dates and ticket IDs were kept in brackets.

## Checks

- Section headings `## 0.` to `## 20.` and rule numbers `1.`–`20.` present; every `§` section cited in the repo still exists.
- Every repository path cited in CLAUDE.md exists, apart from globs, placeholders and bare file names.
- `scripts/ui-check.mjs`: tested locally (see Rules added).
- `npx next typegen` then `npm run typecheck`: passes (as in CI). Without typegen, 14 TS2307 errors for the PNG imports, because `next-env.d.ts` is gitignored and generated.
- `npx eslint scripts/ui-check.mjs`: passes.
- No test reads CLAUDE.md (checked with grep), so no test covers its text.

## Next

After a few sessions on the new CLAUDE.md, add the transcript sums and the per-turn context to this file. Compare them with the 107,100-token baseline above.

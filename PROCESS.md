# PROCESS

How this project was built with an AI coding agent (Claude Code). One entry per
slice, appended at the slice boundary. The working agreement was: agent plans,
human approves, agent builds one slice, agent stops, human reviews.

## Working agreement

- **Slice at a time.** The agent stops at every slice boundary and waits. No
  "and then I also refactored…".
- **Deviations are proposed, not taken.** Anything outside the agreed plan gets
  raised before it is built, with the reason.
- **Verification before claims.** A slice is only reported done after the
  relevant commands have actually been run and their output read.

---

## Slice 0 — Skeleton

**Goal:** a monorepo that installs, typechecks, tests and builds; plus the
golden dataset and the `npm run eval` harness that later slices score against.

### Planning

The agent read `candidate_task_brief.md` and `mock_mailbox_data.json` first,
then proposed a plan rather than starting to code. Two rounds of human
correction before any file was written:

1. **First plan was revised by the human:** add Tailwind and use it for styling,
   Node 24 rather than "whatever", **Ollama as the primary LLM provider** with
   Gemini free tier as an option (the agent had defaulted to Groq), and add a
   golden dataset `expected.json` plus a separate `npm run eval` script. All
   adopted.
2. **The agent then surfaced four decisions it judged were the human's to
   make**, rather than assuming:
   - *Pipeline execution model* — async job queue vs. synchronous vs. lazy.
     Chose **async queue with status polling**, because two agents over ten
     emails on a local 3B model is a multi-minute first run and a synchronous
     version would show a blank screen throughout.
   - *Entity resolution ambition* — chose **canonical entities keyed by
     `(type, normalized_key)` with an alias table**, deterministic only. This
     is the axis the full-stack track is explicitly graded on.
   - *Run history* — chose **full `processing_runs` + `agent_invocations` audit
     trail** over "latest result only", which suits the compliance framing and
     makes provider comparison possible.
   - *Scope vs. the brief's 5–6h time box* — chose **build it all, report the
     honest elapsed time**.

Second-order consequences the agent flagged on its own: pinning Node 24 makes
the built-in `node:sqlite` viable, which removes the `better-sqlite3` native
compile step from install; and Groq was dropped to keep the provider surface at
three.

### What the agent did autonomously

Scaffolding — workspaces, tsconfigs, vitest projects, `.env.example`, Tailwind
v4 `@theme` token block, the eval loader/matcher/runner, and the ground truth in
`eval/expected.json` (authored by reading all ten seed emails, not generated).

### Where it corrected itself

- **Dynamic Tailwind classes.** It first wrote `` bg-risk-${level}-bg ``, caught
  that Tailwind only scans for *literal* class strings, and replaced it with a
  static `RISK_BADGE_CLASS` map. This would have typechecked and built cleanly
  while emitting no CSS at all — so the fix was verified by grepping the built
  stylesheet for the six expected utilities, not by assuming.
- **Duplicate Vite installs.** `npm run typecheck` failed with an opaque
  `Plugin` type mismatch. Root cause was version skew: vitest 3 pulls vite 7,
  the web app was pinned to vite 6, so npm nested a second copy and the two
  `Plugin` types were structurally different. Fixed by aligning the web app on
  vite 7 rather than by loosening the types.
- **`tsx` over a dual build.** Rather than maintain a `src`/`dist` split for the
  shared package plus a separate API build, the API runs from TypeScript source
  in both dev and start. One less thing that can drift.

### Notes on the golden dataset

Written by hand from the ten emails, and deliberately not exact-match — LLM tag
vocabulary and entity granularity vary run to run. Every assertion is a
"must contain" set, risk is scored with **adjacent-band partial credit**, and
risky cases carry a `minimumAcceptableRisk` floor so a missed wire fraud is
reported as a *critical miss* rather than averaged away by ten benign emails.

The corpus has a genuinely useful pair: **E009** (legitimate Northgate invoice,
account …6621) against **E004** (same vendor, "updated" account …9902). E009
carries `forbiddenTags`, so the eval measures precision — if E009 scores high,
the pipeline is matching on the word "invoice" rather than on anomaly.

### Verification

```
npm install     149 packages, 0 vulnerabilities
npm test        4 files, 20 tests passed
npm run typecheck   shared, api, web, eval — all clean
npm run eval    dataset valid, covers the corpus exactly, exit 0
npm run build   web builds; 6/6 risk utilities present in the emitted CSS
npm start       api scaffold boots on the configured port
```

### Open items carried forward

- `node:sqlite` is the slice-1 bet; fall back to `better-sqlite3` behind the
  same repository interface if it fights.
- Badge colour contrast is asserted by intent in the token comments, not yet
  measured. To be checked in slice 4.

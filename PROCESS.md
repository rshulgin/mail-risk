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

---

## Slice 1 — Domain contracts + storage

**Goal:** the shared Zod schemas both agents must satisfy, the canonical entity
rules, and a SQLite layer that can hold a cross-email graph plus a full audit
trail.

### One deviation, taken deliberately

**Upgraded zod 3 → 4.** Slice 2 needs JSON Schema to constrain the models
(Ollama's `format`, Gemini's `responseSchema`), and zod 4 ships
`z.toJSONSchema()` natively — zod 3 would have meant adding
`zod-to-json-schema`. The agent raised this before writing any schema, on the
grounds that discovering it one slice later would mean rewriting the schemas
rather than just adding a dependency. Also confirmed by probe, not assumption,
that `node:sqlite` works on the pinned Node with no experimental warning, so
the `better-sqlite3` fallback stays unused.

### Design decisions worth defending

**Open vocabularies, closed taxonomies.** Risk *levels* and entity *types* are
closed enums — the UI has to colour them and the eval has to score them. Risk
*tags* and relationship *types* are open strings, normalised to kebab- and
snake-case respectively. A closed tag enum would silently discard a risk
category we did not think of; the cost is only a messier tag cloud.

**Canonical keys merge on formatting, never on inference.** `normalizeEntityKey`
collapses `James Harrington` / `J. Harrington` / `j.harrington-ceo@…` to
`j harrington`, and `$1.2M` / `$1,200,000` to `1200000`. It deliberately does
*not* merge `Northgate` into `Northgate Suppliers` — that is a guess, and in a
graph used for risk work a wrongly merged node invents a connection that was
never observed. Under-merging is visible and fixable; over-merging is neither.
The lookalike-domain test pins this down: `arcline.com` and
`arclline-portal.com` must stay separate, which is the whole point of E008.

**Unresolvable relationship endpoints drop their edge.** Agent B returns
relationships as free strings that may not match its own entity list. The
resolver tries canonical key, then exact display name, then unique token
containment — and returns null when two candidates match equally well. No
phantom nodes.

**Mentions and relationships are keyed by run, not by email.** Reprocessing
produces a fresh graph fragment; the old one stays queryable for the audit
trail but drops out of every "current graph" query, which all join
`emails.latest_run_id`. Verified by a test that reprocesses an email and asserts
the stale node disappears from the aggregate graph while its row survives.

### Where the agent corrected itself

- **`node:sqlite` row typing.** `.all()` returns
  `Record<string, SQLOutputValue>[]`, which will not cast to a hand-written row
  interface. The agent's first instinct was to double-cast through `unknown` at
  each of the four call sites; it rejected that and instead declared the row
  DTOs *as* SQL rows with an index signature — one honest declaration per DTO
  rather than four scattered escape hatches.
- **A path bug caught by a stray non-zero exit.** A verification command ended
  with `ls data/` and failed. Root cause: npm runs a workspace script with the
  cwd set to that workspace, so `DATABASE_PATH=./data/mail-risk.db` resolved
  under `apps/api/` for `npm start` but at the repo root for other entry points
  — two silently different databases. Fixed by anchoring relative paths to a
  repo root derived from `import.meta.url`, and verified by booting from both
  directories and confirming one database file. Worth noting that nothing in
  the test suite would have caught this; it surfaced only because the exit code
  of a throwaway `ls` was actually read rather than skimmed.

### Verification

```
npm test        9 files, 73 tests passed
npm run typecheck   shared, api, web, eval — clean
npm run eval    still green after the zod 4 upgrade
npm start       migrates, reports counts; identical DB path from repo root and from apps/api
```

### Carried forward

- E010's ground-truth level (`medium`) is still open for the human to confirm;
  it shapes what slice 2's prompt tuning optimises toward.
- Badge colour contrast still asserted by intent, not measured. Slice 4.

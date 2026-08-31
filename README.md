# Mail Risk Intelligence

A two-agent pipeline over a compliance mailbox: it extracts structure from
incoming email, assesses risk, and builds an entity graph that spans the whole
corpus rather than one message at a time.

Built for the Arcline take-home, **full-stack/pipeline track** — so the weight
is on agent orchestration, the entity/relationship data model, and API design.
See [PROCESS.md](PROCESS.md) for how it was built with an AI agent, including
the things that went wrong.

---

## Quick start

```bash
nvm use          # Node 24+
npm install
npm run dev      # api on :3001, web on :5173
```

Open <http://localhost:5173>. The mailbox seeds itself from
`mock_mailbox_data.json` on first boot and starts processing immediately.

**No API key is needed, and no `.env` is required.** The default is a local
model via Ollama:

```bash
# optional, but this is the default path
ollama pull llama3.2:3b
```

**Don't want to install Ollama?** Everything still works:

```bash
npm run dev:rules
```

The pipeline falls back to deterministic heuristics and the UI says so in a
banner. Rule-based output is never presented as though a model produced it.

```bash
npm test         # 250 tests, no model or network required
npm run eval     # score the pipeline against the golden dataset
npm run build    # production build of the web app
```

---

## Architecture

```
                  ┌───────────── ingestion ─────────────┐
  seed JSON ──┐   │                                     │
  pasted text ├──▶│  parse → RawEmail → store(pending)   │
  .eml        │   │                                     │
  .pdf ───────┘   └──────────────────┬──────────────────┘
                                     │ enqueue
                          ┌──────────▼──────────┐
                          │  work queue          │  bounded concurrency
                          └──────────┬──────────┘
                                     │
        ┌────────────────────────────▼────────────────────────────┐
        │  orchestrator                                            │
        │                                                          │
        │   Agent A ──▶ ExtractionResult ──▶ Agent B ──▶ Risk +     │
        │   (extract)                       (assess)     Graph      │
        │                                                          │
        │   each agent: timeout → retry → JSON repair → validate    │
        │               → fall back to heuristics if all else fails │
        └────────────────────────────┬────────────────────────────┘
                                     │
                        ┌────────────▼────────────┐
                        │  SQLite (node:sqlite)    │
                        │  emails · runs · agent   │
                        │  invocations · entities  │
                        │  aliases · mentions ·    │
                        │  relationships           │
                        └────────────┬────────────┘
                                     │
                          Express API ──▶ React UI
```

| Path | Responsibility |
| --- | --- |
| `packages/shared` | Domain contracts: Zod schemas for both agents, risk taxonomy, entity normalisation |
| `apps/api/src/ingest` | Four input formats → one `RawEmail` |
| `apps/api/src/agents` | Providers, prompts, retry ladder, orchestrator, queue, heuristics |
| `apps/api/src/storage` | SQLite schema, migrations, three repositories |
| `apps/api/src/routes` | REST API and serializers |
| `apps/web` | Vite + React + Zustand + Tailwind |
| `eval/` | Golden dataset and scorer |

~9,500 lines of TypeScript including tests.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | provider, model, queue depth, counts |
| GET | `/api/emails` | list; filters `status`, `minRisk`, `q` |
| GET | `/api/emails/:id` | raw + extraction + risk + entities + relationships + run |
| POST | `/api/emails` | ingest JSON `{text}` or a multipart file → **202** |
| POST | `/api/emails/:id/reprocess` | re-run the pipeline, new run row |
| GET | `/api/emails/:id/runs` | audit trail, including failed attempts |
| GET | `/api/graph` | aggregate graph; `minRisk` filter |
| GET | `/api/entities/:id` | aliases, source emails, neighbours |

Errors use one envelope throughout: `{ error: { code, message, details? } }`.

---

## Key decisions

### The degradation ladder, not a success/failure switch

Each agent independently tries the model, retries with the validation error fed
back into the prompt, and falls back to deterministic heuristics if it still
cannot produce valid output. An email therefore *always* ends up with an
assessment, and the run record says exactly how it was reached
(`completed` / `degraded` / `failed`, with a reason).

This is the honest version of "don't let the whole app break". It also has a
sharp edge, which the eval caught — see *Attribution* below.

### Canonical entities merge on formatting, never on inference

`normalizeEntityKey` collapses `James Harrington` / `J. Harrington` /
`j.harrington-ceo@…` into one entity, and `$1.2M` / `$1,200,000` into another.
It deliberately does **not** merge `Northgate` into `Northgate Suppliers` —
that is a guess, and in a graph used for risk work a wrongly-merged node
invents a connection nobody observed. Under-merging is visible and fixable;
over-merging is neither.

Relatedly, relationship endpoints that cannot be resolved to a named entity
drop their edge rather than inventing a node.

### Mentions and relationships are keyed by run, not by email

Reprocessing produces a fresh graph fragment. The previous one stays queryable
for the audit trail but drops out of every "current graph" query, which all
join `emails.latest_run_id`. Reprocessing therefore replaces rather than
duplicates, with no delete step.

### POST returns 202

An assessment takes 30–90s on a local model. The email is stored and queued;
the client polls `status`. Holding a connection open for a minute would be a
worse API and a worse UI.

### Provenance is always visible

`/api/health` carries the provider, and every risk verdict in the UI shows
`provider/model · duration · confidence`. When the pipeline is running on
heuristics, an amber banner says so in words. Rule-based output rendering
indistinguishably from model output would be the most misleading thing this
app could do.

### Styling: Tailwind v4 with a token block

Risk levels are defined once as colour tokens in `@theme`, so a badge cannot
drift between the inbox and the detail view. Risk is always stated as text as
well as colour, with an `sr-only` prefix for screen readers — never colour
alone.

---

## Model choice, measured

`npm run eval --model=<name>` scores the real pipeline against
`eval/expected.json`. On CPU-only inference:

| Model | Overall | Exact risk | Critical misses | Rules fallbacks | Wall clock |
| --- | --- | --- | --- | --- | --- |
| **`llama3.2:3b`** (default) | **84%** | 9/10 | 0 | 0 | 12.9 min |
| `phi3:mini` | 79% | 7/10 | 0 | 3 | 30.2 min |
| `qwen2.5:3b` | 71% | 8/10 | 1 | 0 | 9.5 min |
| `mistral:latest` | *not measurable* | — | — | 15 | 53.4 min |
| `rules` (no model) | 93% | 10/10 | 0 | — | ~0s |

Two numbers in that table need explaining, and both are more interesting than
the headline.

**`mistral` is not measurable at the default timeout.** Its per-email times
cluster at exactly 361.5s — 2 agents × 3 attempts × the 60s `AGENT_TIMEOUT_MS`.
It timed out on every call and was carried entirely by the rules fallback. Set
`AGENT_TIMEOUT_MS=300000` before judging any 7B model on CPU.

**The `rules` 93% is not a win for heuristics.** That signal table was written
against these ten emails and is pinned to them by tests. It is fitted to the
corpus and would degrade sharply on an eleventh email. It exists to keep the
app usable when no model is reachable, not to win the benchmark.

### Attribution

Because a fallback can rescue a failing provider, the eval reports **who did
the work**:

```
attribution   <n>/10 model-driven (<score>), <m> fallback-assisted (<score>)
```

A case counts as model-driven only when both agents used the model. The report
warns loudly when a provider contributed nothing at all. Without this, mistral's
run reported 91% with zero critical misses and would have gone into this README
as the recommendation.

---

## Testing

250 tests across 24 files. `npm test` needs no model and no network — the
pipeline is exercised through a scriptable fake provider and the rules path.

Covered failure modes: model timeout, transient provider error, unparseable
text, schema violation, repeated failure into fallback, provider entirely down,
retry-budget exhaustion, reprocessing, unsupported upload type, PDF with no
text layer, malformed JSON body, unknown ids, and a dead API from the client's
point of view.

The golden dataset is deliberately *not* exact-match: assertions are
"must contain" sets, risk scoring gives partial credit for an adjacent band,
and risky emails carry a floor below which a result is reported as a **critical
miss** rather than averaged away.

---

## Tradeoffs and what I'd do next

**E004 is the one critical miss.** The redirected-invoice email is rated `low`
by `llama3.2:3b`, which reasons that changing payment details is "a routine
business update". The real tell is cross-email — E009 establishes account …6621
as the account on file for the same vendor — and a single-email pipeline cannot
see it. **The highest-value next step is feeding the entity graph back into
Agent B**: when an email mentions an entity already in the graph, include its
history in the prompt. The data model already supports this; only the prompt
assembly is missing.

Other things I would do with more time, roughly in order:

- **Entity resolution beyond formatting.** An LLM-assisted merge pass for
  near-matches, with the deterministic layer as a floor and human review for
  proposed merges.
- **Streaming status.** Polling is fine at this scale; SSE would be better and
  is a small change given the queue already knows.
- **Confidence calibration.** Models self-report confidence badly. Comparing
  reported confidence against eval outcomes would let it be rescaled or dropped.
- **A batch view.** With hundreds of emails the inbox needs grouping by entity
  or campaign, not just a flat list.
- **Graph performance.** The canvas renderer is fine to a few hundred nodes;
  beyond that it needs quadtree hit-testing and level-of-detail labels.
- **Accessibility beyond basics.** Focus rings, semantics, keyboard paths and
  non-colour risk encoding are done; a real screen-reader pass is not.

### Known limitations

- The graph canvas is `aria-hidden`; the entity list beside it is the
  accessible route to the same selection. That is a deliberate pairing, not a
  substitute for a proper accessible graph.
- `npm run dev:rules` uses POSIX shell env syntax. On Windows, set
  `LLM_PROVIDER=rules` in `.env` instead.
- Attachment text in the seed data arrives pre-extracted; only the upload path
  exercises real PDF parsing.

---

## Time spent

Commits span 27–30 August, but that is not focused time — most of the elapsed
wall clock was unattended: a single `npm run eval` takes 10 minutes on CPU-only
inference, and the four-model benchmark ran for about 95 minutes on its own.

Focused build time was roughly **7–8 hours**, against the brief's 5–6. The
overshoot went into the eval harness and the model benchmark, neither of which
the brief asked for. I would make that trade again — the eval is what caught
the two pipeline bugs that mattered, and it is the reason the model
recommendation above is measured rather than asserted.

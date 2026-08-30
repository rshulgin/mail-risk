# Mail Risk Intelligence

Two-agent pipeline over a compliance mailbox: extract structure from incoming
email, assess risk, and build a cross-email entity graph.

> **Status: in progress.** Built slice by slice; see [PROCESS.md](PROCESS.md)
> for the running log. This README is filled out as each slice lands.

## Quick start

```bash
nvm use            # Node 24+
npm install
npm test           # unit + integration, no model required
npm run eval       # score the pipeline against the golden dataset
npm run dev        # api + web
```

No `.env` is required — every setting has a working default, and if the
configured LLM is unreachable the app falls back to a deterministic rule-based
provider rather than failing to start. See [.env.example](.env.example).

## Layout

| Path | What lives there |
| --- | --- |
| `packages/shared` | Domain contracts: Zod schemas, risk taxonomy, entity normalisation |
| `apps/api` | Express API, SQLite storage, ingestion, agent orchestration |
| `apps/web` | Vite + React + Zustand + Tailwind UI |
| `eval/` | Golden dataset and `npm run eval` scorer |

## Decisions so far

- **Node 24+, ESM, TypeScript throughout.** Run directly from TS sources via
  `tsx` for the API; no dual build step to keep in sync.
- **npm workspaces**, not pnpm/turbo/nx — a bare `npm install` is enough.
- **Tailwind v4** with a `@theme` token block. Risk levels are defined as colour
  tokens once, so a badge cannot drift between the inbox and the detail view.
- **Ollama primary, Gemini optional, deterministic rules as fallback.** Nothing
  paid, nothing required.
- **Default model `llama3.2:3b`, chosen by measurement rather than reputation.**
  Scored against the golden dataset with `npm run eval --model=<name>` on
  CPU-only inference:

  | Model | Overall | Exact risk | Rules fallbacks | Wall clock |
  | --- | --- | --- | --- | --- |
  | `llama3.2:3b` (default) | 84% | 9/10 | 0 | ~13 min |
  | `phi3:mini` | 79% | 7/10 | 3 | ~30 min |
  | `qwen2.5:3b` | 71% | 8/10 | 0 | ~10 min |
  | `mistral:latest` | not measurable | — | 15 | ~53 min |

  `mistral` exceeded the 60s per-agent timeout on every call and was carried
  entirely by the rules fallback; it needs `AGENT_TIMEOUT_MS=300000` to be
  assessed fairly. Raise that value before reaching for a larger model.
- **`npm run eval` is separate from `npm test`.** Model output varies between
  runs; letting it gate the test suite would make the suite unreliable.

Full architecture notes, tradeoffs and "what I'd do with more time" land with
the last slice.

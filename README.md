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
- **`npm run eval` is separate from `npm test`.** Model output varies between
  runs; letting it gate the test suite would make the suite unreliable.

Full architecture notes, tradeoffs and "what I'd do with more time" land with
the last slice.

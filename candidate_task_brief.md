# Take-Home Assignment: Mail Risk Intelligence

Thanks for taking the time to work on this. We designed this to be closer to real
work than a typical algorithm test: an ambiguous-ish spec, real tool choices to
make, and a chance to show how you actually build things in 2026 — including how
you use AI coding tools.

There are two tracks for this role. You've been told which one applies to you;
the core spec is identical, only the evaluation emphasis differs (see "What
we're evaluating").

---

## Scenario

Arcline is a (fictional) compliance/risk team. Emails and documents land in a
mailbox, and someone needs to figure out — fast — who's involved, what they're
asking for, and whether anything looks risky (fraud, insider threat, phishing,
harassment, market-abuse chatter, etc).

You're building the first version of that tool.

## What to build

A small full-stack app: **Mail Risk Intelligence**

### 1. Mailbox
- A list view of incoming emails, seeded from `mock_mailbox_data.json`
  (provided separately).
- Ability to add a new item to the mailbox: paste raw email text, or upload a
  `.txt`/`.pdf`/`.eml` file. It should flow through the same pipeline as the
  seed data.

### 2. Processing pipeline (two agents, chained)

**Agent A — Extraction Agent**
Input: raw email (+ attachment text if present).
Output: structured JSON — sender, recipients, date, subject, a short summary,
and key extracted facts (amounts, dates, account/reference numbers, any
attachment content).

**Agent B — Risk & Graph Agent**
Input: Agent A's structured output.
Output:
- a risk assessment: level (none/low/medium/high), a short rationale, and tags
  (e.g. `urgency`, `financial-anomaly`, `threat-language`, `mnpi-risk`)
- extracted entities: people, organizations, amounts, accounts, locations
- relationships between entities (e.g. `Person —requests_transfer_to→ Org`,
  `Person —employed_by→ Org`)

Use a **free-tier or local LLM** for both agents — no paid key should be
required to run this. Good options: Groq's free API (fast, generous free
tier), Google Gemini free tier, or a local model via Ollama (llama3, mistral,
phi3). Pick whatever you're comfortable with, and document your choice.

Handle the unhappy path: what happens if the model call fails, times out, or
returns garbage? Don't let the whole app break because of it.

### 3. Storage
Persist processed emails + their extracted entities/relationships. SQLite, a
JSON file, or in-memory is all fine — we're not testing your database
provisioning skills.

### 4. UI
- Inbox list: sender, subject, date, a color-coded risk badge.
- Detail view: original content + structured extraction + risk rationale.
- Entities/relationships panel for the selected email.
- **Bonus:** a knowledge graph view aggregating entities/relationships across
  *all* processed emails — interactive (pan/zoom, click a node to see its
  connections).
- Must be usable on a narrow (mobile-width) viewport, not just desktop.

## Tech constraints

- **Frontend:** React + TypeScript. Styling approach is your choice (CSS
  Modules, Tailwind, styled-components, plain CSS) — justify it briefly in
  your README.
- **Backend:** Node/Express or Python/FastAPI, your choice.
- **LLM:** free-tier or local, as above. Include a `.env.example` and describe
  fallback behavior if the API is unavailable when we run it.
- No auth/user accounts needed.

## What we're evaluating

Everyone:
- Judgment on an ambiguous spec — sensible assumptions, sensible scoping
- **How you used AI tooling to build this.** Please include a `PROCESS.md`
  (or an exported Cursor/agent plan) showing your prompting and planning
  approach — where you let an agent run autonomously, where you stepped in
  and corrected it, how you broke the work into sub-tasks/sub-agents if you
  did. This is a real part of the grade, not a formality.
- Code architecture: clean separation between ingestion, agent orchestration,
  storage, API, and UI
- Handling of failure modes (bad input, agent errors, empty states)
- At least some tests
- README clarity

**If you're on the UI-focused track**, we'll additionally weight:
- Visual design quality and consistency (spacing, type scale, color use)
- Responsiveness across breakpoints
- Accessibility basics (contrast, keyboard nav, focus states)
- Loading/empty/error state polish
- Interaction quality of the knowledge graph (if attempted)

**If you're on the full-stack/pipeline-focused track**, we'll additionally weight:
- Agent orchestration design and robustness
- Data modeling for entities/relationships (extensibility)
- API design

## Deliverables

- A git repo (GitHub link or zip)
- `README.md`: setup/run instructions, architecture overview, key decisions
  and tradeoffs, what you'd do with more time
- `PROCESS.md`: your AI-agent workflow artifacts (see above)
- Optional: a 3–5 min screen recording walking through the app

## Time box

Aim for around **5–6 focused hours**. We don't expect production polish — we
expect good judgment about what to prioritize in that time. Please tell us
honestly how long you spent; it helps us calibrate the task, not judge you.

## Seed data

`mock_mailbox_data.json` — 10 emails to load into your mailbox on first run.
Feel free to add a few of your own for testing too.

---

Questions during the task are welcome — reach out any time.

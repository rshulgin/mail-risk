import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type {
  AgentName,
  ExtractionResult,
  InvocationStatus,
  ProviderName,
  RunStatus,
} from '@mri/shared';
import type { InvocationRecord, RunRecord, StoredRisk } from './types.js';

/** Raw SQL row. The index signature is what `node:sqlite` hands back, so
 *  declaring it here keeps the cast honest instead of double-casting. */
interface RunRow {
  [column: string]: SQLOutputValue;
  id: string;
  email_id: string;
  provider: string;
  model: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  degraded_reason: string | null;
  error: string | null;
}

const toRun = (row: RunRow): RunRecord => ({
  id: row.id,
  emailId: row.email_id,
  provider: row.provider as ProviderName,
  model: row.model,
  status: row.status as RunStatus,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  durationMs: row.duration_ms,
  degradedReason: row.degraded_reason,
  error: row.error,
});

/**
 * The audit trail. Every pipeline execution opens a run; every agent attempt —
 * including timeouts and unparseable responses — is recorded against it.
 *
 * This is what makes a degraded result explainable months later, and what lets
 * two providers be compared on the same email.
 */
export function createRunRepo(db: DatabaseSync) {
  return {
    start(emailId: string, provider: ProviderName, model: string): RunRecord {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO processing_runs (id, email_id, provider, model, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      ).run(id, emailId, provider, model, new Date().toISOString());
      return this.get(id)!;
    },

    finish(
      runId: string,
      outcome: { status: RunStatus; degradedReason?: string; error?: string },
    ): void {
      const run = this.get(runId);
      if (!run) return;

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - new Date(run.startedAt).getTime();

      db.prepare(
        `UPDATE processing_runs
            SET status = ?, finished_at = ?, duration_ms = ?, degraded_reason = ?, error = ?
          WHERE id = ?`,
      ).run(
        outcome.status,
        finishedAt.toISOString(),
        durationMs,
        outcome.degradedReason ?? null,
        outcome.error ?? null,
        runId,
      );
    },

    recordInvocation(input: {
      runId: string;
      agent: AgentName;
      attempt: number;
      status: InvocationStatus;
      durationMs: number;
      error?: string;
      rawResponse?: string;
    }): void {
      db.prepare(
        `INSERT INTO agent_invocations
           (id, run_id, agent, attempt, status, duration_ms, error, raw_response, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        input.runId,
        input.agent,
        input.attempt,
        input.status,
        input.durationMs,
        input.error ?? null,
        // Truncated: a runaway model response should not bloat the database.
        input.rawResponse ? input.rawResponse.slice(0, 8_000) : null,
        new Date().toISOString(),
      );
    },

    saveExtraction(emailId: string, runId: string, extraction: ExtractionResult): void {
      db.prepare(
        `INSERT INTO extractions (id, email_id, run_id, summary, payload)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET summary = excluded.summary, payload = excluded.payload`,
      ).run(randomUUID(), emailId, runId, extraction.summary, JSON.stringify(extraction));
    },

    saveRisk(emailId: string, runId: string, risk: StoredRisk): void {
      db.prepare(
        `INSERT INTO risk_assessments (id, email_id, run_id, level, rationale, tags, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           level = excluded.level, rationale = excluded.rationale,
           tags = excluded.tags, confidence = excluded.confidence`,
      ).run(
        randomUUID(),
        emailId,
        runId,
        risk.level,
        risk.rationale,
        JSON.stringify(risk.tags),
        risk.confidence,
      );
    },

    get(runId: string): RunRecord | null {
      const row = db.prepare('SELECT * FROM processing_runs WHERE id = ?').get(runId) as
        | RunRow
        | undefined;
      return row ? toRun(row) : null;
    },

    listForEmail(emailId: string): RunRecord[] {
      const rows = db
        .prepare('SELECT * FROM processing_runs WHERE email_id = ? ORDER BY started_at DESC')
        .all(emailId) as RunRow[];
      return rows.map(toRun);
    },

    listInvocations(runId: string): InvocationRecord[] {
      const rows = db
        .prepare('SELECT * FROM agent_invocations WHERE run_id = ? ORDER BY created_at, attempt')
        .all(runId) as {
        id: string;
        run_id: string;
        agent: string;
        attempt: number;
        status: string;
        duration_ms: number;
        error: string | null;
        raw_response: string | null;
        created_at: string;
      }[];

      return rows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        agent: row.agent as AgentName,
        attempt: row.attempt,
        status: row.status as InvocationStatus,
        durationMs: row.duration_ms,
        error: row.error,
        rawResponse: row.raw_response,
        createdAt: row.created_at,
      }));
    },

    getExtraction(runId: string): ExtractionResult | null {
      const row = db.prepare('SELECT payload FROM extractions WHERE run_id = ?').get(runId) as
        | { payload: string }
        | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.payload) as ExtractionResult;
      } catch {
        return null;
      }
    },

    getRisk(runId: string): StoredRisk | null {
      const row = db
        .prepare('SELECT level, rationale, tags, confidence FROM risk_assessments WHERE run_id = ?')
        .get(runId) as
        | { level: string; rationale: string; tags: string; confidence: number }
        | undefined;
      if (!row) return null;

      let tags: string[] = [];
      try {
        const parsed: unknown = JSON.parse(row.tags);
        if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
      } catch {
        tags = [];
      }

      return {
        level: row.level as StoredRisk['level'],
        rationale: row.rationale,
        tags,
        confidence: row.confidence,
      };
    },
  };
}

export type RunRepo = ReturnType<typeof createRunRepo>;

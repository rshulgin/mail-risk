import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema migrations, applied in order and tracked with SQLite's `user_version`.
 *
 * Append-only: to change the schema, add a new entry rather than editing an
 * existing one, so an existing database can always catch up.
 */
export const MIGRATIONS: readonly string[] = [
  // 1 - initial schema
  `
  CREATE TABLE emails (
    id            TEXT PRIMARY KEY,
    external_id   TEXT UNIQUE,
    source        TEXT NOT NULL,
    raw_text      TEXT NOT NULL,
    from_address  TEXT NOT NULL DEFAULT '',
    to_addresses  TEXT NOT NULL DEFAULT '[]',
    subject       TEXT NOT NULL DEFAULT '',
    sent_at       TEXT,
    created_at    TEXT NOT NULL,
    status        TEXT NOT NULL,
    latest_run_id TEXT
  );

  CREATE TABLE attachments (
    id             TEXT PRIMARY KEY,
    email_id       TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    filename       TEXT NOT NULL,
    extracted_text TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE processing_runs (
    id              TEXT PRIMARY KEY,
    email_id        TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    status          TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    duration_ms     INTEGER,
    degraded_reason TEXT,
    error           TEXT
  );

  -- One row per agent attempt, including the ones that failed. This is what
  -- makes "why did this email end up degraded?" answerable after the fact.
  CREATE TABLE agent_invocations (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
    agent        TEXT NOT NULL,
    attempt      INTEGER NOT NULL,
    status       TEXT NOT NULL,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    error        TEXT,
    raw_response TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE extractions (
    id       TEXT PRIMARY KEY,
    email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    run_id   TEXT NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
    summary  TEXT NOT NULL DEFAULT '',
    payload  TEXT NOT NULL,
    UNIQUE(run_id)
  );

  CREATE TABLE risk_assessments (
    id         TEXT PRIMARY KEY,
    email_id   TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    run_id     TEXT NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
    level      TEXT NOT NULL,
    rationale  TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0.5,
    UNIQUE(run_id)
  );

  -- Entities are global and shared across emails. The (type, canonical_key)
  -- uniqueness constraint is what makes the cross-email graph possible.
  CREATE TABLE entities (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    canonical_key TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    UNIQUE(type, canonical_key)
  );

  -- Every distinct surface form that resolved to an entity. Gives the UI the
  -- honest answer to "what was actually written in the email?".
  CREATE TABLE entity_aliases (
    id               TEXT PRIMARY KEY,
    entity_id        TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    alias            TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    UNIQUE(entity_id, normalized_alias)
  );

  -- Mentions and relationships are scoped to a run, not just an email, so a
  -- reprocess replaces the graph fragment instead of duplicating it.
  CREATE TABLE entity_mentions (
    id           TEXT PRIMARY KEY,
    entity_id    TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    email_id     TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    run_id       TEXT NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
    surface_form TEXT NOT NULL,
    context      TEXT NOT NULL DEFAULT '',
    UNIQUE(entity_id, run_id)
  );

  CREATE TABLE relationships (
    id               TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    type             TEXT NOT NULL,
    email_id         TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    run_id           TEXT NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
    evidence         TEXT NOT NULL DEFAULT '',
    UNIQUE(source_entity_id, target_entity_id, type, run_id)
  );

  CREATE INDEX idx_emails_status          ON emails(status);
  CREATE INDEX idx_emails_created         ON emails(created_at DESC);
  CREATE INDEX idx_attachments_email      ON attachments(email_id);
  CREATE INDEX idx_runs_email             ON processing_runs(email_id, started_at DESC);
  CREATE INDEX idx_invocations_run        ON agent_invocations(run_id);
  CREATE INDEX idx_extractions_email      ON extractions(email_id);
  CREATE INDEX idx_risk_email             ON risk_assessments(email_id);
  CREATE INDEX idx_mentions_email_run     ON entity_mentions(email_id, run_id);
  CREATE INDEX idx_mentions_entity        ON entity_mentions(entity_id);
  CREATE INDEX idx_relationships_run      ON relationships(email_id, run_id);
  CREATE INDEX idx_relationships_source   ON relationships(source_entity_id);
  CREATE INDEX idx_relationships_target   ON relationships(target_entity_id);
  `,
];

export function migrate(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      // PRAGMA does not accept bound parameters, and `version + 1` is a number
      // we produced, not user input.
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return MIGRATIONS.length;
}

import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { EmailSource, EmailStatus, RawEmail, RiskLevel } from '@mri/shared';
import { RISK_ORDER } from '@mri/shared';
import { transaction } from './db.js';
import type { EmailRecord, EmailSummary } from './types.js';

/** Raw SQL row. The index signature is what `node:sqlite` hands back, so
 *  declaring it here keeps the cast honest instead of double-casting. */
interface EmailRow {
  [column: string]: SQLOutputValue;
  id: string;
  external_id: string | null;
  source: string;
  raw_text: string;
  from_address: string;
  to_addresses: string;
  subject: string;
  sent_at: string | null;
  created_at: string;
  status: string;
  latest_run_id: string | null;
}

const parseJsonArray = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

export interface EmailFilter {
  status?: EmailStatus;
  /** Inclusive floor, e.g. `medium` returns medium and high. */
  minRisk?: RiskLevel;
  /** Case-insensitive match over subject, sender and summary. */
  query?: string;
}

export function createEmailRepo(db: DatabaseSync) {
  const attachmentsFor = (emailId: string) =>
    (
      db
        .prepare('SELECT filename, extracted_text FROM attachments WHERE email_id = ? ORDER BY rowid')
        .all(emailId) as { filename: string; extracted_text: string }[]
    ).map((row) => ({ filename: row.filename, extractedText: row.extracted_text }));

  const toRecord = (row: EmailRow): EmailRecord => ({
    id: row.id,
    externalId: row.external_id,
    source: row.source as EmailSource,
    rawText: row.raw_text,
    from: row.from_address,
    to: parseJsonArray(row.to_addresses),
    subject: row.subject,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    status: row.status as EmailStatus,
    latestRunId: row.latest_run_id,
    attachments: attachmentsFor(row.id),
  });

  return {
    /**
     * Inserts an email in `pending`. Returns the existing record instead when
     * `externalId` is already present, which makes seeding idempotent across
     * restarts without a separate "has it been seeded?" flag.
     */
    insert(input: { email: RawEmail; rawText: string; source: EmailSource }): EmailRecord {
      const existing = input.email.externalId
        ? this.findByExternalId(input.email.externalId)
        : null;
      if (existing) return existing;

      const id = randomUUID();
      const now = new Date().toISOString();

      return transaction(db, () => {
        db.prepare(
          `INSERT INTO emails
             (id, external_id, source, raw_text, from_address, to_addresses,
              subject, sent_at, created_at, status, latest_run_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL)`,
        ).run(
          id,
          input.email.externalId ?? null,
          input.source,
          input.rawText,
          input.email.from,
          JSON.stringify(input.email.to),
          input.email.subject,
          input.email.date || null,
          now,
        );

        const insertAttachment = db.prepare(
          'INSERT INTO attachments (id, email_id, filename, extracted_text) VALUES (?, ?, ?, ?)',
        );
        for (const attachment of input.email.attachments) {
          insertAttachment.run(randomUUID(), id, attachment.filename, attachment.extractedText);
        }

        return this.get(id)!;
      });
    },

    get(id: string): EmailRecord | null {
      const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(id) as EmailRow | undefined;
      return row ? toRecord(row) : null;
    },

    findByExternalId(externalId: string): EmailRecord | null {
      const row = db.prepare('SELECT * FROM emails WHERE external_id = ?').get(externalId) as
        | EmailRow
        | undefined;
      return row ? toRecord(row) : null;
    },

    /**
     * Inbox query. Joins each email to the risk assessment of its latest run,
     * so an email that is mid-reprocess still shows its previous verdict rather
     * than blanking out.
     */
    list(filter: EmailFilter = {}): EmailSummary[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];

      if (filter.status) {
        clauses.push('e.status = ?');
        params.push(filter.status);
      }
      if (filter.minRisk) {
        const acceptable = Object.entries(RISK_ORDER)
          .filter(([, rank]) => rank >= RISK_ORDER[filter.minRisk as RiskLevel])
          .map(([level]) => level);
        clauses.push(`r.level IN (${acceptable.map(() => '?').join(', ')})`);
        params.push(...acceptable);
      }
      if (filter.query) {
        clauses.push(
          '(LOWER(e.subject) LIKE ? OR LOWER(e.from_address) LIKE ? OR LOWER(COALESCE(x.summary, \'\')) LIKE ?)',
        );
        const needle = `%${filter.query.toLowerCase()}%`;
        params.push(needle, needle, needle);
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

      const rows = db
        .prepare(
          `SELECT e.id, e.external_id, e.source, e.from_address, e.to_addresses, e.subject,
                  e.sent_at, e.created_at, e.status,
                  x.summary AS summary,
                  r.level   AS risk_level,
                  r.tags    AS risk_tags,
                  (SELECT COUNT(*) FROM attachments a WHERE a.email_id = e.id) AS attachment_count
             FROM emails e
             LEFT JOIN extractions      x ON x.run_id = e.latest_run_id
             LEFT JOIN risk_assessments r ON r.run_id = e.latest_run_id
             ${where}
            ORDER BY COALESCE(e.sent_at, e.created_at) DESC`,
        )
        .all(...params) as (EmailRow & {
        summary: string | null;
        risk_level: string | null;
        risk_tags: string | null;
        attachment_count: number;
      })[];

      return rows.map((row) => ({
        id: row.id,
        externalId: row.external_id,
        source: row.source as EmailSource,
        from: row.from_address,
        to: parseJsonArray(row.to_addresses),
        subject: row.subject,
        sentAt: row.sent_at,
        createdAt: row.created_at,
        status: row.status as EmailStatus,
        summary: row.summary,
        riskLevel: (row.risk_level as RiskLevel | null) ?? null,
        riskTags: row.risk_tags ? parseJsonArray(row.risk_tags) : [],
        attachmentCount: row.attachment_count,
      }));
    },

    setStatus(id: string, status: EmailStatus): void {
      db.prepare('UPDATE emails SET status = ? WHERE id = ?').run(status, id);
    },

    setLatestRun(id: string, runId: string): void {
      db.prepare('UPDATE emails SET latest_run_id = ? WHERE id = ?').run(runId, id);
    },

    /** Ids awaiting work, oldest first — used to refill the queue on boot. */
    idsWithStatus(status: EmailStatus): string[] {
      return (
        db
          .prepare(
            // rowid as tiebreak: seeding ten emails takes well under a
            // millisecond, so created_at ties and the queue would pick them up
            // in arbitrary order — defeating the chronological seeding that
            // cross-email context depends on.
            'SELECT id FROM emails WHERE status = ? ORDER BY created_at, rowid',
          )
          .all(status) as {
          id: string;
        }[]
      ).map((row) => row.id);
    },

    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM emails').get() as { n: number };
      return row.n;
    },
  };
}

export type EmailRepo = ReturnType<typeof createEmailRepo>;

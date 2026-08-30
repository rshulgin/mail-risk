import type { EmailRecord, EmailSummary, Storage } from '../storage/index.js';

/**
 * API response shapes.
 *
 * Kept apart from the storage records so the wire format is a deliberate
 * choice rather than whatever the database happens to hold. Notably, every
 * response that carries an assessment also carries `provider` and `model`, so
 * the UI can tell the reviewer whether a verdict came from a model or from the
 * deterministic fallback. That distinction should never be invisible.
 */

export const serializeSummary = (email: EmailSummary) => ({
  id: email.id,
  externalId: email.externalId,
  source: email.source,
  from: email.from,
  to: email.to,
  subject: email.subject,
  sentAt: email.sentAt,
  receivedAt: email.createdAt,
  status: email.status,
  summary: email.summary,
  risk: email.riskLevel ? { level: email.riskLevel, tags: email.riskTags } : null,
  attachmentCount: email.attachmentCount,
});

export function serializeDetail(storage: Storage, record: EmailRecord) {
  const run = record.latestRunId ? storage.runs.get(record.latestRunId) : null;
  const extraction = record.latestRunId ? storage.runs.getExtraction(record.latestRunId) : null;
  const risk = record.latestRunId ? storage.runs.getRisk(record.latestRunId) : null;
  const graph = storage.graph.getEmailGraph(record.id);

  return {
    id: record.id,
    externalId: record.externalId,
    source: record.source,
    from: record.from,
    to: record.to,
    subject: record.subject,
    sentAt: record.sentAt,
    receivedAt: record.createdAt,
    status: record.status,
    rawText: record.rawText,
    attachments: record.attachments,
    extraction,
    risk,
    run: run
      ? {
          id: run.id,
          provider: run.provider,
          model: run.model,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
          degradedReason: run.degradedReason,
          error: run.error,
        }
      : null,
    entities: graph.entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
      name: entity.displayName,
      surfaceForm: entity.surfaceForm,
      context: entity.context,
    })),
    relationships: graph.relationships.map((edge) => ({
      id: edge.id,
      type: edge.type,
      evidence: edge.evidence,
      source: { id: edge.source.id, name: edge.source.displayName, type: edge.source.type },
      target: { id: edge.target.id, name: edge.target.displayName, type: edge.target.type },
    })),
  };
}

import { beforeEach, describe, expect, it } from 'vitest';
import { rawEmailSchema, type RawEmail } from '@mri/shared';
import { createStorage, type Storage } from './index.js';

const email = (overrides: Partial<RawEmail> = {}): RawEmail =>
  rawEmailSchema.parse({
    from: 'j.harrington-ceo@arclne-corp.com',
    to: ['finance-ops@arcline.com'],
    date: '2026-06-02T08:14:00Z',
    subject: 'URGENT - confidential wire needed before noon',
    body: 'Please wire $184,500 today.',
    ...overrides,
  });

/** Ingest an email and open a run for it, the state most tests start from. */
const ingest = (storage: Storage, overrides: Partial<RawEmail> = {}) => {
  const record = storage.emails.insert({
    email: email(overrides),
    rawText: 'raw',
    source: 'seed',
  });
  const run = storage.runs.start(record.id, 'rules', 'heuristic-v1');
  storage.emails.setLatestRun(record.id, run.id);
  return { record, run };
};

describe('storage', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = createStorage(':memory:');
  });

  describe('emails', () => {
    it('stores an email as pending with its attachments', () => {
      const record = storage.emails.insert({
        email: email({
          externalId: 'E004',
          attachments: [{ filename: 'invoice.pdf', extractedText: 'account ending 9902' }],
        }),
        rawText: 'raw text',
        source: 'seed',
      });

      expect(record.status).toBe('pending');
      expect(record.attachments).toHaveLength(1);
      expect(record.attachments[0]?.extractedText).toBe('account ending 9902');
      expect(storage.emails.get(record.id)?.to).toEqual(['finance-ops@arcline.com']);
    });

    it('is idempotent on externalId, so reseeding does not duplicate', () => {
      const first = storage.emails.insert({
        email: email({ externalId: 'E001' }),
        rawText: 'raw',
        source: 'seed',
      });
      const second = storage.emails.insert({
        email: email({ externalId: 'E001' }),
        rawText: 'raw',
        source: 'seed',
      });

      expect(second.id).toBe(first.id);
      expect(storage.emails.count()).toBe(1);
    });

    it('surfaces the latest run risk in the inbox list', () => {
      const { record, run } = ingest(storage);
      storage.runs.saveExtraction(record.id, run.id, {
        sender: 'j.harrington-ceo@arclne-corp.com',
        recipients: [],
        date: '',
        subject: '',
        summary: 'Urgent wire request.',
        facts: [],
      });
      storage.runs.saveRisk(record.id, run.id, {
        level: 'high',
        rationale: 'Classic BEC pattern.',
        tags: ['urgency', 'impersonation'],
        confidence: 0.9,
      });

      const [row] = storage.emails.list();
      expect(row?.riskLevel).toBe('high');
      expect(row?.riskTags).toEqual(['urgency', 'impersonation']);
      expect(row?.summary).toBe('Urgent wire request.');
    });

    it('filters by minimum risk inclusively', () => {
      const high = ingest(storage, { externalId: 'HIGH' });
      storage.runs.saveRisk(high.record.id, high.run.id, {
        level: 'high',
        rationale: '',
        tags: [],
        confidence: 1,
      });
      const none = ingest(storage, { externalId: 'NONE' });
      storage.runs.saveRisk(none.record.id, none.run.id, {
        level: 'none',
        rationale: '',
        tags: [],
        confidence: 1,
      });

      expect(storage.emails.list({ minRisk: 'medium' }).map((e) => e.externalId)).toEqual(['HIGH']);
      expect(storage.emails.list({ minRisk: 'none' })).toHaveLength(2);
    });

    it('lists ids waiting for the queue', () => {
      const { record } = ingest(storage, { externalId: 'A' });
      storage.emails.insert({ email: email({ externalId: 'B' }), rawText: 'r', source: 'paste' });
      storage.emails.setStatus(record.id, 'completed');

      expect(storage.emails.idsWithStatus('pending')).toHaveLength(1);
    });
  });

  describe('runs and audit trail', () => {
    it('records every attempt, including the failed ones', () => {
      const { record, run } = ingest(storage);

      storage.runs.recordInvocation({
        runId: run.id,
        agent: 'extraction',
        attempt: 1,
        status: 'invalid_output',
        durationMs: 120,
        error: 'not JSON',
        rawResponse: 'Sure! Here is the JSON:',
      });
      storage.runs.recordInvocation({
        runId: run.id,
        agent: 'extraction',
        attempt: 2,
        status: 'ok',
        durationMs: 340,
      });
      storage.runs.finish(run.id, { status: 'completed' });

      const invocations = storage.runs.listInvocations(run.id);
      expect(invocations.map((i) => i.status)).toEqual(['invalid_output', 'ok']);
      expect(storage.runs.get(run.id)?.status).toBe('completed');
      expect(storage.runs.get(run.id)?.durationMs).toBeGreaterThanOrEqual(0);
      expect(storage.runs.listForEmail(record.id)).toHaveLength(1);
    });

    it('keeps a degraded run explainable', () => {
      const { run } = ingest(storage);
      storage.runs.finish(run.id, {
        status: 'degraded',
        degradedReason: 'risk agent failed; fell back to rules',
      });

      const stored = storage.runs.get(run.id);
      expect(stored?.status).toBe('degraded');
      expect(stored?.degradedReason).toContain('fell back to rules');
    });

    it('truncates a runaway model response', () => {
      const { run } = ingest(storage);
      storage.runs.recordInvocation({
        runId: run.id,
        agent: 'risk_graph',
        attempt: 1,
        status: 'invalid_output',
        durationMs: 1,
        rawResponse: 'x'.repeat(20_000),
      });

      expect(storage.runs.listInvocations(run.id)[0]?.rawResponse).toHaveLength(8_000);
    });
  });

  describe('canonical entities', () => {
    it('merges the surface forms of one person into a single entity', () => {
      const a = storage.graph.upsertEntity('person', 'James Harrington');
      const b = storage.graph.upsertEntity('person', 'J. Harrington');
      const c = storage.graph.upsertEntity('person', 'j.harrington-ceo@arclne-corp.com');

      expect(a?.id).toBe(b?.id);
      expect(b?.id).toBe(c?.id);
      expect(storage.graph.countEntities()).toBe(1);
      expect(storage.graph.getAliases(a!.id)).toHaveLength(3);
    });

    it('merges an amount across formats', () => {
      const a = storage.graph.upsertEntity('amount', '$1.2M');
      const b = storage.graph.upsertEntity('amount', '$1,200,000');
      expect(a?.id).toBe(b?.id);
    });

    it('refuses to create an entity with no usable key', () => {
      expect(storage.graph.upsertEntity('amount', 'a large sum')).toBeNull();
      expect(storage.graph.countEntities()).toBe(0);
    });
  });

  describe('graph fragments', () => {
    it('links relationships to the entities named in the same email', () => {
      const { record, run } = ingest(storage);

      const result = storage.graph.persistFragment({
        emailId: record.id,
        runId: run.id,
        entities: [
          { type: 'person', name: 'James Harrington', context: 'sender' },
          { type: 'organization', name: 'Arcline', context: 'employer' },
          { type: 'amount', name: '$184,500', context: 'requested wire' },
        ],
        relationships: [
          {
            source: 'James Harrington',
            target: 'Arcline',
            type: 'employed_by',
            evidence: 'signs as CEO',
          },
        ],
      });

      expect(result).toMatchObject({ entityCount: 3, relationshipCount: 1, droppedRelationships: 0 });

      const graph = storage.graph.getEmailGraph(record.id);
      expect(graph.entities).toHaveLength(3);
      expect(graph.relationships[0]?.source.displayName).toBe('James Harrington');
      expect(graph.relationships[0]?.target.displayName).toBe('Arcline');
    });

    it('resolves a partial name used in a relationship', () => {
      const { record, run } = ingest(storage);
      const result = storage.graph.persistFragment({
        emailId: record.id,
        runId: run.id,
        entities: [
          { type: 'person', name: 'Rina Tanaka', context: '' },
          { type: 'person', name: 'Marcus Kelly', context: '' },
        ],
        relationships: [
          { source: 'Rina', target: 'Marcus', type: 'discloses_information_to', evidence: '' },
        ],
      });

      expect(result.relationshipCount).toBe(1);
    });

    it('drops an edge whose endpoint was never named, rather than inventing a node', () => {
      const { record, run } = ingest(storage);
      const result = storage.graph.persistFragment({
        emailId: record.id,
        runId: run.id,
        entities: [{ type: 'person', name: 'James Harrington', context: '' }],
        relationships: [
          { source: 'James Harrington', target: 'Nobody In Particular', type: 'pays', evidence: '' },
        ],
      });

      expect(result).toMatchObject({ relationshipCount: 0, droppedRelationships: 1 });
      expect(storage.graph.getEmailGraph(record.id).relationships).toHaveLength(0);
    });

    it('drops entities whose name normalises to nothing', () => {
      const { record, run } = ingest(storage);
      const result = storage.graph.persistFragment({
        emailId: record.id,
        runId: run.id,
        entities: [
          { type: 'person', name: 'James Harrington', context: '' },
          { type: 'amount', name: 'an unspecified sum', context: '' },
        ],
        relationships: [],
      });

      expect(result).toMatchObject({ entityCount: 1, droppedEntities: 1 });
    });
  });

  describe('aggregate graph', () => {
    it('joins the same entity across two emails into one node', () => {
      const first = ingest(storage, { externalId: 'E004' });
      storage.graph.persistFragment({
        emailId: first.record.id,
        runId: first.run.id,
        entities: [{ type: 'organization', name: 'Northgate Suppliers Inc.', context: '' }],
        relationships: [],
      });
      storage.runs.saveRisk(first.record.id, first.run.id, {
        level: 'high',
        rationale: '',
        tags: [],
        confidence: 1,
      });

      const second = ingest(storage, { externalId: 'E009' });
      storage.graph.persistFragment({
        emailId: second.record.id,
        runId: second.run.id,
        entities: [{ type: 'organization', name: 'Northgate Suppliers', context: '' }],
        relationships: [],
      });
      storage.runs.saveRisk(second.record.id, second.run.id, {
        level: 'none',
        rationale: '',
        tags: [],
        confidence: 1,
      });

      const { nodes } = storage.graph.getAggregateGraph();
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.mentionCount).toBe(2);
      expect(nodes[0]?.emailIds).toHaveLength(2);
      // The node inherits the worst risk it has been seen in.
      expect(nodes[0]?.highestRisk).toBe('high');
    });

    it('excludes fragments from superseded runs after a reprocess', () => {
      const { record, run } = ingest(storage);
      storage.graph.persistFragment({
        emailId: record.id,
        runId: run.id,
        entities: [{ type: 'organization', name: 'Stale Org', context: '' }],
        relationships: [],
      });

      const rerun = storage.runs.start(record.id, 'rules', 'heuristic-v1');
      storage.emails.setLatestRun(record.id, rerun.id);
      storage.graph.persistFragment({
        emailId: record.id,
        runId: rerun.id,
        entities: [{ type: 'organization', name: 'Fresh Org', context: '' }],
        relationships: [],
      });

      const { nodes } = storage.graph.getAggregateGraph();
      expect(nodes.map((n) => n.displayName)).toEqual(['Fresh Org']);
      // The superseded entity row survives for the audit trail; it is simply
      // no longer part of the current graph.
      expect(storage.graph.countEntities()).toBe(2);
    });

    it('collapses the same claim from two emails into one edge citing both', () => {
      for (const externalId of ['E001', 'E002']) {
        const { record, run } = ingest(storage, { externalId });
        storage.graph.persistFragment({
          emailId: record.id,
          runId: run.id,
          entities: [
            { type: 'person', name: 'James Harrington', context: '' },
            { type: 'organization', name: 'Arcline', context: '' },
          ],
          relationships: [
            { source: 'James Harrington', target: 'Arcline', type: 'employed_by', evidence: '' },
          ],
        });
      }

      const { edges } = storage.graph.getAggregateGraph();
      expect(edges).toHaveLength(1);
      expect(edges[0]?.emailIds).toHaveLength(2);
    });
  });
});

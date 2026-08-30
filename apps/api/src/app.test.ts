import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { createStorage, type Storage } from './storage/index.js';
import { createIngestService } from './ingest/index.js';
import { createOrchestrator } from './agents/orchestrator.js';
import { createQueue } from './agents/queue.js';
import { config } from './config.js';

const pdfFixture = (): Buffer =>
  readFileSync(fileURLToPath(new URL('./ingest/__fixtures__/invoice.pdf', import.meta.url)));

/**
 * The API is exercised end to end against the rules provider: no network, no
 * model, deterministic output. That keeps `npm test` fast and reliable while
 * still covering the real ingest -> pipeline -> storage -> API path.
 */
function harness() {
  const storage: Storage = createStorage(':memory:');
  const ingest = createIngestService(storage);
  const orchestrator = createOrchestrator({
    storage,
    provider: null,
    timeoutMs: 1_000,
    maxRetries: 0,
    internalDomains: ['arcline.com'],
  });
  const queue = createQueue({
    concurrency: 2,
    handler: (id) => orchestrator.process(id),
  });
  const app = createApp({ storage, ingest, queue, orchestrator, providerFallbackReason: null });

  return { app, storage, ingest, queue, orchestrator };
}

describe('API', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  describe('GET /api/health', () => {
    it('reports the provider so the UI can label heuristic results honestly', async () => {
      const res = await request(h.app).get('/api/health').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.provider).toMatchObject({ name: 'rules', degraded: true });
      expect(res.body.queue).toHaveProperty('concurrency', 2);
      expect(res.body.counts).toHaveProperty('emails', 0);
    });
  });

  describe('POST /api/emails', () => {
    it('accepts pasted text, answers 202, and processes it', async () => {
      const res = await request(h.app)
        .post('/api/emails')
        .send({
          text: [
            'From: j.harrington-ceo@arclne-corp.com',
            'To: finance-ops@arcline.com',
            'Subject: URGENT - confidential wire needed',
            '',
            "Wire $184,500 today before noon. Treat this as confidential and don't loop in anyone else.",
          ].join('\n'),
        })
        .expect(202);

      expect(res.body.status).toBe('pending');
      expect(res.body.risk).toBeNull();

      await h.queue.onIdle();

      const after = await request(h.app).get(`/api/emails/${res.body.id}`).expect(200);
      expect(after.body.status).toBe('completed');
      expect(after.body.risk.level).toBe('high');
      expect(after.body.run).toMatchObject({ provider: 'rules', status: 'completed' });
      expect(after.body.entities.length).toBeGreaterThan(0);
    });

    it('accepts an uploaded .eml through the same pipeline', async () => {
      const eml = [
        'From: k.dubois.ext@partnerlogistics.com',
        'To: s.pillai@arcline.com',
        'Subject: you will regret pulling out of this contract',
        '',
        "I know where your office is and I know people. This isn't over.",
      ].join('\r\n');

      const res = await request(h.app)
        .post('/api/emails')
        .attach('file', Buffer.from(eml), 'threat.eml')
        .expect(202);

      await h.queue.onIdle();

      const after = await request(h.app).get(`/api/emails/${res.body.id}`).expect(200);
      expect(after.body.source).toBe('upload');
      expect(after.body.risk.level).toBe('high');
      expect(after.body.risk.tags).toContain('threat-language');
    });

    it('accepts an uploaded .pdf as an attachment-only email', async () => {
      const res = await request(h.app)
        .post('/api/emails')
        .attach('file', pdfFixture(), 'invoice_NS-4471.pdf')
        .expect(202);

      await h.queue.onIdle();

      const after = await request(h.app).get(`/api/emails/${res.body.id}`).expect(200);
      expect(after.body.attachments[0].extractedText).toContain('47,300');
    });

    it('rejects an empty body with the standard error envelope', async () => {
      const res = await request(h.app).post('/api/emails').send({}).expect(400);

      expect(res.body.error).toMatchObject({ code: 'bad_request' });
      expect(res.body.error.message).toContain('text');
    });

    it('rejects an unsupported file type', async () => {
      const res = await request(h.app)
        .post('/api/emails')
        .attach('file', Buffer.from('MZ'), 'thing.exe')
        .expect(415);

      expect(res.body.error.code).toBe('unsupported_media_type');
    });

    it('rejects malformed JSON without crashing', async () => {
      const res = await request(h.app)
        .post('/api/emails')
        .set('content-type', 'application/json')
        .send('{"text": ')
        .expect(400);

      expect(res.body.error.code).toBe('bad_request');
    });
  });

  describe('GET /api/emails', () => {
    beforeEach(async () => {
      h.ingest.seed(config.seedPath);
      h.queue.enqueueAll(h.storage.emails.idsWithStatus('pending'));
      await h.queue.onIdle();
    });

    it('lists the seeded corpus newest first with risk badges', async () => {
      const res = await request(h.app).get('/api/emails').expect(200);

      expect(res.body.total).toBe(10);
      expect(res.body.emails[0]).toHaveProperty('risk.level');
      const dates = res.body.emails.map((e: { sentAt: string }) => e.sentAt);
      expect(dates).toEqual([...dates].sort().reverse());
    });

    it('filters by minimum risk', async () => {
      const res = await request(h.app).get('/api/emails?minRisk=high').expect(200);

      expect(res.body.total).toBeGreaterThan(0);
      expect(
        res.body.emails.every((e: { risk: { level: string } }) => e.risk.level === 'high'),
      ).toBe(true);
    });

    it('filters by status', async () => {
      const res = await request(h.app).get('/api/emails?status=completed').expect(200);
      expect(res.body.total).toBe(10);
    });

    it('searches subject and sender', async () => {
      const res = await request(h.app).get('/api/emails?q=northgate').expect(200);
      expect(res.body.total).toBe(2);
    });

    it('rejects an invalid filter value', async () => {
      const res = await request(h.app).get('/api/emails?minRisk=catastrophic').expect(400);
      expect(res.body.error.code).toBe('bad_request');
    });

    it('returns an empty list, not an error, when nothing matches', async () => {
      const res = await request(h.app).get('/api/emails?q=zzzznothing').expect(200);
      expect(res.body).toEqual({ emails: [], total: 0 });
    });
  });

  describe('GET /api/emails/:id', () => {
    it('404s on an unknown id', async () => {
      const res = await request(h.app).get('/api/emails/nope').expect(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('POST /api/emails/:id/reprocess', () => {
    it('opens a new run and keeps the old one', async () => {
      const created = await request(h.app)
        .post('/api/emails')
        .send({ text: 'From: a@arcline.com\nSubject: hi\n\nRoutine note.' })
        .expect(202);
      await h.queue.onIdle();

      await request(h.app).post(`/api/emails/${created.body.id}/reprocess`).expect(202);
      await h.queue.onIdle();

      const runs = await request(h.app).get(`/api/emails/${created.body.id}/runs`).expect(200);
      expect(runs.body.runs).toHaveLength(2);
      expect(runs.body.runs.filter((r: { isLatest: boolean }) => r.isLatest)).toHaveLength(1);
    });

    it('404s on an unknown id', async () => {
      await request(h.app).post('/api/emails/nope/reprocess').expect(404);
    });
  });

  describe('GET /api/emails/:id/runs', () => {
    it('exposes the per-agent audit trail', async () => {
      const created = await request(h.app)
        .post('/api/emails')
        .send({ text: 'From: a@arcline.com\nSubject: hi\n\nRoutine note.' })
        .expect(202);
      await h.queue.onIdle();

      const res = await request(h.app).get(`/api/emails/${created.body.id}/runs`).expect(200);
      expect(res.body.runs[0]).toMatchObject({ provider: 'rules', status: 'completed' });
      expect(Array.isArray(res.body.runs[0].invocations)).toBe(true);
    });
  });

  describe('graph endpoints', () => {
    beforeEach(async () => {
      h.ingest.seed(config.seedPath);
      h.queue.enqueueAll(h.storage.emails.idsWithStatus('pending'));
      await h.queue.onIdle();
    });

    it('returns an aggregate graph whose edges only reference returned nodes', async () => {
      const res = await request(h.app).get('/api/graph').expect(200);

      expect(res.body.nodes.length).toBeGreaterThan(0);
      const ids = new Set(res.body.nodes.map((n: { id: string }) => n.id));
      for (const edge of res.body.edges) {
        expect(ids.has(edge.source)).toBe(true);
        expect(ids.has(edge.target)).toBe(true);
      }
    });

    it('keeps that invariant under a risk filter', async () => {
      const res = await request(h.app).get('/api/graph?minRisk=high').expect(200);

      const ids = new Set(res.body.nodes.map((n: { id: string }) => n.id));
      for (const edge of res.body.edges) {
        expect(ids.has(edge.source)).toBe(true);
        expect(ids.has(edge.target)).toBe(true);
      }
      expect(
        res.body.nodes.every((n: { highestRisk: string }) => n.highestRisk === 'high'),
      ).toBe(true);
    });

    it('shows an entity with its aliases and neighbours', async () => {
      const graph = await request(h.app).get('/api/graph').expect(200);
      const node = graph.body.nodes.find((n: { type: string }) => n.type === 'organization');

      const res = await request(h.app).get(`/api/entities/${node.id}`).expect(200);
      expect(res.body).toMatchObject({ id: node.id, type: 'organization' });
      expect(Array.isArray(res.body.aliases)).toBe(true);
      expect(Array.isArray(res.body.emailIds)).toBe(true);
    });

    it('404s on an unknown entity', async () => {
      const res = await request(h.app).get('/api/entities/nope').expect(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('unknown routes', () => {
    it('404s with the standard envelope', async () => {
      const res = await request(h.app).get('/api/nonsense').expect(404);
      expect(res.body.error).toMatchObject({ code: 'not_found' });
    });
  });
});

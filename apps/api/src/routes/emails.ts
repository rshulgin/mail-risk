import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { EMAIL_STATUSES, RISK_LEVELS } from '@mri/shared';
import { ApiError } from '../errors.js';
import type { IngestService } from '../ingest/index.js';
import type { Storage } from '../storage/index.js';
import type { WorkQueue } from '../agents/queue.js';
import { serializeDetail, serializeSummary } from './serializers.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const listQuerySchema = z.object({
  status: z.enum(EMAIL_STATUSES).optional(),
  minRisk: z.enum(RISK_LEVELS).optional(),
  q: z.string().trim().min(1).optional(),
});

const createBodySchema = z.object({
  text: z.string().min(1, 'text must not be empty'),
});

/** Wraps an async handler so a rejection reaches the error middleware. */
const wrap =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (error?: unknown) => void): void => {
    handler(req, res).catch(next);
  };

export function createEmailRoutes(deps: {
  storage: Storage;
  ingest: IngestService;
  queue: WorkQueue;
}): Router {
  const { storage, ingest, queue } = deps;
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  router.get('/', (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.badRequest('Invalid query parameters.', parsed.error.issues);
    }

    const { status, minRisk, q } = parsed.data;
    const emails = storage.emails.list({
      ...(status ? { status } : {}),
      ...(minRisk ? { minRisk } : {}),
      ...(q ? { query: q } : {}),
    });

    res.json({ emails: emails.map(serializeSummary), total: emails.length });
  });

  router.get('/:id', (req, res) => {
    const record = storage.emails.get(req.params.id);
    if (!record) throw ApiError.notFound('Email');
    res.json(serializeDetail(storage, record));
  });

  /**
   * Accepts either JSON `{ text }` or a multipart file upload, and answers 202:
   * the email is stored and queued, but not yet assessed. The client polls the
   * status field rather than holding a connection open for a minute of local
   * inference.
   */
  router.post(
    '/',
    upload.single('file'),
    wrap(async (req, res) => {
      const file = req.file;
      let record;

      if (file) {
        record = await ingest.fromUpload({
          originalname: file.originalname,
          mimetype: file.mimetype,
          buffer: file.buffer,
        });
      } else {
        const parsed = createBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw ApiError.badRequest(
            'Provide either a `text` field or a `file` upload.',
            parsed.error.issues,
          );
        }
        record = ingest.fromText(parsed.data.text);
      }

      queue.enqueue(record.id);
      res.status(202).json(serializeDetail(storage, record));
    }),
  );

  router.post('/:id/reprocess', (req, res) => {
    const record = storage.emails.get(req.params.id);
    if (!record) throw ApiError.notFound('Email');

    storage.emails.setStatus(record.id, 'pending');
    queue.enqueue(record.id);
    res.status(202).json(serializeDetail(storage, storage.emails.get(record.id)!));
  });

  /** The audit trail: every run, and every agent attempt inside it. */
  router.get('/:id/runs', (req, res) => {
    const record = storage.emails.get(req.params.id);
    if (!record) throw ApiError.notFound('Email');

    const runs = storage.runs.listForEmail(record.id).map((run) => ({
      ...run,
      isLatest: run.id === record.latestRunId,
      invocations: storage.runs.listInvocations(run.id).map((invocation) => ({
        agent: invocation.agent,
        attempt: invocation.attempt,
        status: invocation.status,
        durationMs: invocation.durationMs,
        error: invocation.error,
      })),
    }));

    res.json({ runs });
  });

  return router;
}

export { MAX_UPLOAD_BYTES };

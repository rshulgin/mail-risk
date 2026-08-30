import express, { type NextFunction, type Request, type Response } from 'express';
import { MulterError } from 'multer';
import { ApiError } from './errors.js';
import type { IngestService } from './ingest/index.js';
import type { Storage } from './storage/index.js';
import type { WorkQueue } from './agents/queue.js';
import type { Orchestrator } from './agents/orchestrator.js';
import { createEmailRoutes, MAX_UPLOAD_BYTES } from './routes/emails.js';
import { createGraphRoutes } from './routes/graph.js';

export interface AppDeps {
  storage: Storage;
  ingest: IngestService;
  queue: WorkQueue;
  orchestrator: Orchestrator;
  /** Set when the requested provider was unreachable and we fell back. */
  providerFallbackReason?: string | null;
}

export function createApp(deps: AppDeps) {
  const { storage, ingest, queue, orchestrator } = deps;
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  /**
   * Health doubles as the UI's provider banner: it is how the front end knows
   * to say "assessed by rules, not a model" rather than presenting heuristic
   * output as though a model produced it.
   */
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      provider: {
        name: orchestrator.providerName,
        model: orchestrator.modelName,
        degraded: orchestrator.providerName === 'rules',
        fallbackReason: deps.providerFallbackReason ?? null,
      },
      queue: queue.stats(),
      counts: {
        emails: storage.emails.count(),
        entities: storage.graph.countEntities(),
        pending: storage.emails.idsWithStatus('pending').length,
        processing: storage.emails.idsWithStatus('processing').length,
      },
    });
  });

  app.use('/api/emails', createEmailRoutes({ storage, ingest, queue }));
  app.use('/api', createGraphRoutes(storage));

  app.use((_req, res) => {
    res.status(404).json(ApiError.notFound('Route').toBody());
  });

  // Error middleware must keep all four parameters for Express to recognise it.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json(error.toBody());
      return;
    }

    if (error instanceof MulterError) {
      const apiError =
        error.code === 'LIMIT_FILE_SIZE'
          ? new ApiError(
              'payload_too_large',
              `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit.`,
            )
          : ApiError.badRequest(`Upload rejected: ${error.message}`);
      res.status(apiError.status).json(apiError.toBody());
      return;
    }

    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json(ApiError.badRequest('Request body is not valid JSON.').toBody());
      return;
    }

    console.error('[api] unhandled error', error);
    res
      .status(500)
      .json(new ApiError('internal_error', 'Something went wrong handling that request.').toBody());
  });

  return app;
}

import { config } from './config.js';
import { createApp } from './app.js';
import { createStorage } from './storage/index.js';
import { createIngestService } from './ingest/index.js';
import { createOrchestrator } from './agents/orchestrator.js';
import { createQueue } from './agents/queue.js';
import { resolveProvider } from './agents/providers/index.js';

const storage = createStorage(config.databasePath);
const ingest = createIngestService(storage);
const resolution = await resolveProvider(config);

const orchestrator = createOrchestrator({
  storage,
  provider: resolution.provider,
  timeoutMs: config.pipeline.agentTimeoutMs,
  maxRetries: config.pipeline.agentMaxRetries,
  internalDomains: config.pipeline.internalDomains,
});

const queue = createQueue({
  concurrency: config.pipeline.concurrency,
  handler: (emailId) => orchestrator.process(emailId),
  onError: (emailId, error) => console.error(`[pipeline] ${emailId} failed`, error),
});

const app = createApp({
  storage,
  ingest,
  queue,
  orchestrator,
  providerFallbackReason: resolution.fallbackReason,
});

console.log(`[api] database  ${config.databasePath}`);
console.log(`[api] provider  ${orchestrator.providerName}/${orchestrator.modelName}`);
if (resolution.fallbackReason) {
  console.warn(
    `[api] requested "${resolution.requested}" but fell back to rules: ${resolution.fallbackReason}`,
  );
}

// Seed on first boot, then re-enqueue anything left unfinished by a previous
// process. Both are driven off stored state, so a restart mid-run recovers.
const seeded = ingest.seed(config.seedPath);
if (seeded.inserted.length) {
  console.log(`[api] seeded    ${seeded.inserted.length} emails from ${config.seedPath}`);
}

const outstanding = [
  ...storage.emails.idsWithStatus('pending'),
  ...storage.emails.idsWithStatus('processing'),
];
if (outstanding.length) {
  queue.enqueueAll(outstanding);
  console.log(`[api] queued    ${outstanding.length} emails (concurrency ${config.pipeline.concurrency})`);
}

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://127.0.0.1:${config.port}`);
});

const shutdown = (signal: string) => {
  console.log(`\n[api] ${signal} received, shutting down`);
  server.close(() => {
    storage.close();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

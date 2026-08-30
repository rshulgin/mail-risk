import { config } from './config.js';
import { createStorage } from './storage/index.js';
import { createOrchestrator } from './agents/orchestrator.js';
import { createQueue } from './agents/queue.js';
import { resolveProvider } from './agents/providers/index.js';

/**
 * Slice 2 boot check: resolves a provider, opens storage, and wires the queue
 * to the orchestrator. The Express app on top of this lands in slice 3.
 */
const storage = createStorage(config.databasePath);
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

console.log(`[api] database  ${config.databasePath}`);
console.log(`[api] provider  ${orchestrator.providerName}/${orchestrator.modelName}`);
if (resolution.fallbackReason) {
  console.warn(
    `[api] requested "${resolution.requested}" but fell back to rules: ${resolution.fallbackReason}`,
  );
}
console.log(`[api] storage   ${storage.emails.count()} emails, ${storage.graph.countEntities()} entities`);
console.log(`[api] queue     concurrency ${queue.stats().concurrency}`);
console.log('[api] routes and seeding arrive in slice 3');

storage.close();

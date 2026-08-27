import { config } from './config.js';

/**
 * Slice 0 placeholder. The Express app, storage and pipeline land in slices
 * 1-3; this only proves the workspace boots under Node 24 with TS sources.
 */
console.log(
  `[api] scaffold ready - port ${config.port}, llm provider "${config.llm.provider}"`,
);
console.log('[api] routes arrive in slice 3');

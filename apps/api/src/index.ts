import { config } from './config.js';
import { createStorage } from './storage/index.js';

/**
 * Slice 1 boot check: opens and migrates the database, reports what is in it.
 * The Express app and the pipeline arrive in slices 2 and 3.
 */
const storage = createStorage(config.databasePath);

console.log(`[api] database ready at ${config.databasePath}`);
console.log(`[api] ${storage.emails.count()} emails, ${storage.graph.countEntities()} entities`);
console.log(`[api] llm provider "${config.llm.provider}" (routes arrive in slice 3)`);

storage.close();

import { openDatabase, type DatabaseSync } from './db.js';
import { createEmailRepo } from './email-repo.js';
import { createGraphRepo } from './graph-repo.js';
import { createRunRepo } from './run-repo.js';

/**
 * The storage facade. Everything above this layer depends on these three
 * repositories, never on SQL or on `node:sqlite` directly.
 */
export interface Storage {
  db: DatabaseSync;
  emails: ReturnType<typeof createEmailRepo>;
  runs: ReturnType<typeof createRunRepo>;
  graph: ReturnType<typeof createGraphRepo>;
  close(): void;
}

export function createStorage(path: string): Storage {
  const db = openDatabase(path);
  return {
    db,
    emails: createEmailRepo(db),
    runs: createRunRepo(db),
    graph: createGraphRepo(db),
    close: () => db.close(),
  };
}

export * from './types.js';
export { resolveEndpoint } from './endpoint-resolver.js';
export type { EmailFilter } from './email-repo.js';
export type { FragmentResult } from './graph-repo.js';

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './schema.js';

/**
 * Opens (and migrates) the database.
 *
 * `node:sqlite` is the built-in driver, which means no native compile step at
 * install time. Everything below is plain SQL behind repository functions, so
 * swapping to `better-sqlite3` — or to a JSON store — is a change to this file
 * and the repositories, not to the pipeline or the API.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  migrate(db);
  return db;
}

/**
 * Runs `fn` inside a transaction. Used wherever one logical write touches
 * several tables — persisting a run's entities and relationships, for example,
 * must not leave half a graph behind if it throws partway.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export type { DatabaseSync };

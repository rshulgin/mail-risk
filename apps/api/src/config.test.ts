import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { config, resolveFromRoot, REPO_ROOT } from './config.js';

describe('config', () => {
  it('runs on defaults with no .env present', () => {
    expect(config.llm.provider).toBe('ollama');
    expect(config.pipeline.concurrency).toBeGreaterThan(0);
    expect(config.pipeline.agentTimeoutMs).toBeGreaterThan(0);
  });

  it('anchors relative paths to the repo root, not the working directory', () => {
    expect(isAbsolute(config.databasePath)).toBe(true);
    expect(config.databasePath.startsWith(REPO_ROOT)).toBe(true);
  });

  it('resolves the seed corpus to a file that actually exists', () => {
    expect(existsSync(config.seedPath)).toBe(true);
  });

  it('leaves an absolute path alone', () => {
    expect(resolveFromRoot('/tmp/elsewhere.db')).toBe('/tmp/elsewhere.db');
  });
});

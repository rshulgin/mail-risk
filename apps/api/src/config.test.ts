import { describe, expect, it } from 'vitest';
import { config } from './config.js';

describe('config', () => {
  it('runs on defaults with no .env present', () => {
    expect(config.llm.provider).toBe('ollama');
    expect(config.pipeline.concurrency).toBeGreaterThan(0);
    expect(config.pipeline.agentTimeoutMs).toBeGreaterThan(0);
  });
});

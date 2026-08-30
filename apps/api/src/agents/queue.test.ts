import { describe, expect, it, vi } from 'vitest';
import { createQueue } from './queue.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('work queue', () => {
  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const gates = new Map<string, ReturnType<typeof deferred>>();

    const queue = createQueue({
      concurrency: 2,
      async handler(id) {
        active += 1;
        peak = Math.max(peak, active);
        const gate = deferred();
        gates.set(id, gate);
        await gate.promise;
        active -= 1;
      },
    });

    queue.enqueueAll(['a', 'b', 'c', 'd', 'e']);
    await Promise.resolve();

    expect(queue.stats()).toMatchObject({ inFlight: 2, waiting: 3 });

    // Release everything as it starts.
    const idle = queue.onIdle();
    while (gates.size < 5 || active > 0) {
      for (const [id, gate] of gates) {
        gate.resolve();
        gates.delete(id);
      }
      await new Promise((r) => setTimeout(r, 0));
      if (queue.stats().inFlight === 0 && queue.stats().waiting === 0) break;
    }
    await idle;

    expect(peak).toBe(2);
  });

  it('ignores an id that is already queued or running', () => {
    const queue = createQueue({ concurrency: 1, handler: () => new Promise(() => {}) });

    expect(queue.enqueue('a')).toBe(true);
    expect(queue.enqueue('a')).toBe(false); // now in flight
    expect(queue.enqueue('b')).toBe(true);
    expect(queue.enqueue('b')).toBe(false); // now waiting
    expect(queue.stats()).toMatchObject({ inFlight: 1, waiting: 1 });
  });

  it('keeps draining after a handler rejects', async () => {
    const processed: string[] = [];
    const onError = vi.fn();

    const queue = createQueue({
      concurrency: 1,
      handler(id) {
        processed.push(id);
        return id === 'boom' ? Promise.reject(new Error('nope')) : Promise.resolve();
      },
      onError,
    });

    queue.enqueueAll(['boom', 'next']);
    await queue.onIdle();

    expect(processed).toEqual(['boom', 'next']);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('resolves onIdle immediately when there is nothing to do', async () => {
    const queue = createQueue({ concurrency: 1, handler: () => Promise.resolve() });
    await expect(queue.onIdle()).resolves.toBeUndefined();
  });

  it('processes in FIFO order at concurrency 1', async () => {
    const seen: string[] = [];
    const queue = createQueue({
      concurrency: 1,
      handler(id) {
        seen.push(id);
        return Promise.resolve();
      },
    });

    queue.enqueueAll(['first', 'second', 'third']);
    await queue.onIdle();

    expect(seen).toEqual(['first', 'second', 'third']);
  });
});

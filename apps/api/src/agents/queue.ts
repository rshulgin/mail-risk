/**
 * In-process work queue with bounded concurrency.
 *
 * Deliberately not a job library: the requirement is "do not hammer a local 3B
 * model and keep the server responsive", which is a FIFO and a semaphore. State
 * lives in SQLite, so anything lost on restart is recoverable by re-enqueuing
 * whatever is still `pending`.
 */
export interface QueueOptions {
  concurrency: number;
  handler(id: string): Promise<unknown>;
  onError?(id: string, error: unknown): void;
}

export function createQueue(options: QueueOptions) {
  const concurrency = Math.max(1, options.concurrency);
  const waiting: string[] = [];
  const inFlight = new Set<string>();
  let idleResolvers: (() => void)[] = [];

  const settleIfIdle = () => {
    if (waiting.length === 0 && inFlight.size === 0) {
      for (const resolve of idleResolvers) resolve();
      idleResolvers = [];
    }
  };

  const pump = (): void => {
    while (inFlight.size < concurrency && waiting.length > 0) {
      const id = waiting.shift();
      if (id === undefined) break;

      inFlight.add(id);
      void options
        .handler(id)
        .catch((error: unknown) => options.onError?.(id, error))
        .finally(() => {
          inFlight.delete(id);
          settleIfIdle();
          pump();
        });
    }
    settleIfIdle();
  };

  return {
    /** Ignores ids already queued or running, so double-submits are harmless. */
    enqueue(id: string): boolean {
      if (inFlight.has(id) || waiting.includes(id)) return false;
      waiting.push(id);
      pump();
      return true;
    },

    enqueueAll(ids: readonly string[]): number {
      return ids.filter((id) => this.enqueue(id)).length;
    },

    /** Resolves when nothing is queued or running. */
    onIdle(): Promise<void> {
      if (waiting.length === 0 && inFlight.size === 0) return Promise.resolve();
      return new Promise((resolve) => idleResolvers.push(resolve));
    },

    stats() {
      return { waiting: waiting.length, inFlight: inFlight.size, concurrency };
    },
  };
}

export type WorkQueue = ReturnType<typeof createQueue>;

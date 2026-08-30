import type { Health } from '../api/types.js';

/**
 * States plainly what produced the assessments on screen.
 *
 * When the pipeline is running on heuristics rather than a model, the user has
 * to know — presenting rule-based output as though a model produced it would be
 * the most misleading thing this interface could do.
 */
export function ProviderBanner({ health }: { health: Health | null }) {
  if (!health) return null;

  const { provider, counts, queue } = health;
  const busy = counts.pending + counts.processing + queue.inFlight;

  if (provider.degraded) {
    return (
      <div
        role="status"
        className="border-risk-medium-border bg-risk-medium-bg text-risk-medium border-b px-4 py-2 text-xs sm:px-6"
      >
        <span className="font-semibold">Rule-based mode.</span>{' '}
        {provider.fallbackReason
          ? `${provider.fallbackReason}. `
          : 'No language model is configured. '}
        Assessments below come from deterministic heuristics, not a model.
      </div>
    );
  }

  return (
    <div className="border-line bg-surface text-ink-muted border-b px-4 py-2 text-xs sm:px-6">
      Assessed by{' '}
      <span className="text-ink font-medium">
        {provider.name}/{provider.model}
      </span>
      {busy > 0 && <span> · {busy} in progress</span>}
      <span> · {counts.entities} entities across {counts.emails} emails</span>
    </div>
  );
}

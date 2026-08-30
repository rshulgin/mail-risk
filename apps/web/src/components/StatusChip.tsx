import type { EmailStatus } from '@mri/shared';
import { STATUS_LABEL } from '../risk-styles.js';

const BUSY: EmailStatus[] = ['pending', 'processing'];

/**
 * Shown only while an email is not finished cleanly. A completed email needs
 * no chip — its risk badge already says everything.
 */
export function StatusChip({ status }: { status: EmailStatus }) {
  if (status === 'completed') return null;

  const busy = BUSY.includes(status);
  const tone =
    status === 'failed'
      ? 'bg-risk-high-bg text-risk-high border-risk-high-border'
      : status === 'degraded'
        ? 'bg-risk-medium-bg text-risk-medium border-risk-medium-border'
        : 'bg-surface-sunken text-ink-muted border-line';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="border-ink-muted size-2 animate-spin rounded-full border border-t-transparent"
        />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

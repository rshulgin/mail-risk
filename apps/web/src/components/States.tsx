import type { ReactNode } from 'react';

/**
 * The loading / empty / error triad, in one place.
 *
 * Every list and panel in the app routes through these, so an unpopulated
 * screen always explains itself rather than rendering as a blank rectangle.
 */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="text-ink-muted flex items-center justify-center gap-3 p-8 text-sm" role="status">
      <span
        aria-hidden="true"
        className="border-ink-muted size-4 animate-spin rounded-full border-2 border-t-transparent"
      />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-ink-muted max-w-sm text-sm">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="border-risk-high-border bg-risk-high-bg m-4 flex flex-col items-start gap-3 rounded-lg border p-4"
    >
      <div>
        <p className="text-risk-high text-sm font-semibold">Something went wrong</p>
        <p className="text-ink mt-1 text-sm">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="border-risk-high-border text-risk-high hover:bg-surface rounded-md border bg-white/60 px-3 py-1.5 text-sm font-medium"
        >
          Try again
        </button>
      )}
    </div>
  );
}

import type { EmailDetail as EmailDetailData } from '../api/types.js';
import { RiskBadge } from './RiskBadge.js';
import { StatusChip } from './StatusChip.js';
import { EntitiesPanel } from './EntitiesPanel.js';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="border-line bg-surface rounded-lg border p-4">
    <h3 className="text-sm font-semibold">{title}</h3>
    <div className="mt-3">{children}</div>
  </section>
);

const formatDateTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : '—';

export function EmailDetail({
  email,
  onReprocess,
  onBack,
}: {
  email: EmailDetailData;
  onReprocess(): void;
  onBack(): void;
}) {
  const busy = email.status === 'pending' || email.status === 'processing';

  return (
    <article className="flex flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-accent self-start text-sm font-medium md:hidden"
        >
          ← Back to inbox
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight">
              {email.subject || <span className="text-ink-muted italic">No subject</span>}
            </h2>
            <p className="text-ink-muted mt-1 text-sm break-words">
              <span className="text-ink">{email.from || 'Unknown sender'}</span>
              {email.to.length > 0 && <> → {email.to.join(', ')}</>}
            </p>
            <p className="text-ink-muted mt-0.5 text-xs">{formatDateTime(email.sentAt)}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <RiskBadge level={email.risk?.level ?? null} size="md" />
            <StatusChip status={email.status} />
          </div>
        </div>
      </header>

      {email.status === 'failed' && (
        <div
          role="alert"
          className="border-risk-high-border bg-risk-high-bg text-risk-high rounded-lg border p-3 text-sm"
        >
          Processing failed{email.run?.error ? `: ${email.run.error}` : '.'} The original message is
          still readable below.
        </div>
      )}

      {email.status === 'degraded' && email.run?.degradedReason && (
        <div
          role="status"
          className="border-risk-medium-border bg-risk-medium-bg text-risk-medium rounded-lg border p-3 text-sm"
        >
          <span className="font-semibold">Partial result.</span> {email.run.degradedReason}.
        </div>
      )}

      {email.risk && (
        <Section title="Risk assessment">
          <p className="text-sm leading-relaxed">{email.risk.rationale}</p>
          {email.risk.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {email.risk.tags.map((tag) => (
                <li
                  key={tag}
                  className="border-line bg-surface-sunken rounded-full border px-2 py-0.5 text-[11px] font-medium"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
          {email.run && (
            <p className="text-ink-muted mt-3 text-xs">
              {email.run.provider}/{email.run.model}
              {email.run.durationMs !== null && <> · {(email.run.durationMs / 1000).toFixed(1)}s</>}
              {' · confidence '}
              {Math.round(email.risk.confidence * 100)}%
            </p>
          )}
        </Section>
      )}

      {busy && !email.risk && (
        <Section title="Risk assessment">
          <p className="text-ink-muted text-sm">
            Analysing this email. The result appears here automatically when the pipeline finishes.
          </p>
        </Section>
      )}

      <Section title="Entities & relationships">
        <EntitiesPanel entities={email.entities} relationships={email.relationships} />
      </Section>

      {email.extraction && (
        <Section title="Structured extraction">
          {email.extraction.summary && (
            <p className="text-sm leading-relaxed">{email.extraction.summary}</p>
          )}
          {email.extraction.facts.length > 0 ? (
            <dl className="mt-3 flex flex-col gap-2">
              {email.extraction.facts.map((fact, index) => (
                <div key={`${fact.kind}-${fact.value}-${index}`} className="flex gap-3 text-sm">
                  <dt className="text-ink-muted w-20 shrink-0 text-xs uppercase tracking-wide">
                    {fact.kind}
                  </dt>
                  <dd className="min-w-0">
                    <span className="font-medium">{fact.value}</span>
                    {fact.context && <span className="text-ink-muted"> — {fact.context}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-ink-muted mt-2 text-sm">No structured facts were extracted.</p>
          )}
        </Section>
      )}

      <Section title="Original content">
        <pre className="text-ink bg-surface-sunken max-h-96 overflow-auto rounded-md p-3 text-xs leading-relaxed whitespace-pre-wrap">
          {email.rawText}
        </pre>
        {email.attachments.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {email.attachments.map((attachment) => (
              <details key={attachment.filename} className="border-line rounded-md border p-2">
                <summary className="cursor-pointer text-xs font-medium">
                  {attachment.filename}
                </summary>
                <pre className="text-ink-muted mt-2 overflow-auto text-xs whitespace-pre-wrap">
                  {attachment.extractedText || 'No text extracted.'}
                </pre>
              </details>
            ))}
          </div>
        )}
      </Section>

      <div>
        <button
          type="button"
          onClick={onReprocess}
          disabled={busy}
          className="border-line bg-surface hover:bg-surface-muted rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Analysing…' : 'Re-analyse'}
        </button>
      </div>
    </article>
  );
}

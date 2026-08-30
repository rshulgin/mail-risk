import type { EmailListItem } from '../api/types.js';
import { RISK_RULE_CLASS } from '../risk-styles.js';
import { RiskBadge } from './RiskBadge.js';
import { StatusChip } from './StatusChip.js';

const formatDate = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** Strips a display name so the inbox shows the address people scan for. */
const senderLabel = (from: string): string => {
  const angled = /<([^>]+)>/.exec(from);
  return (angled?.[1] ?? from).trim() || 'Unknown sender';
};

export function InboxList({
  emails,
  selectedId,
  onSelect,
}: {
  emails: EmailListItem[];
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  return (
    <ul className="divide-line divide-y" aria-label="Inbox">
      {emails.map((email) => {
        const selected = email.id === selectedId;
        return (
          <li key={email.id}>
            <button
              type="button"
              onClick={() => onSelect(email.id)}
              aria-current={selected ? 'true' : undefined}
              className={`hover:bg-surface-muted flex w-full flex-col gap-1.5 border-l-4 px-4 py-3 text-left transition-colors ${
                RISK_RULE_CLASS[email.risk?.level ?? 'none']
              } ${selected ? 'bg-accent-bg' : 'bg-surface'}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink truncate text-sm font-medium">
                  {senderLabel(email.from)}
                </span>
                <span className="text-ink-muted shrink-0 text-xs">{formatDate(email.sentAt)}</span>
              </div>

              <span className="text-ink line-clamp-2 text-sm">
                {email.subject || <span className="text-ink-muted italic">No subject</span>}
              </span>

              <div className="flex flex-wrap items-center gap-1.5">
                <RiskBadge level={email.risk?.level ?? null} />
                <StatusChip status={email.status} />
                {email.attachmentCount > 0 && (
                  <span className="text-ink-muted text-[11px]">
                    {email.attachmentCount} attachment{email.attachmentCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

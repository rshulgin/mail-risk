import type { RiskLevel } from '@mri/shared';
import { RISK_BADGE_CLASS } from '../risk-styles.js';

const SIZE_CLASS = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
} as const;

/**
 * Risk is conveyed by the word as well as the colour — never by colour alone,
 * which would be unreadable for a colour-blind reviewer and invisible to a
 * screen reader.
 */
export function RiskBadge({
  level,
  size = 'sm',
}: {
  level: RiskLevel | null;
  size?: keyof typeof SIZE_CLASS;
}) {
  if (!level) {
    return (
      <span
        className={`text-ink-muted border-line inline-flex items-center rounded-full border border-dashed font-medium ${SIZE_CLASS[size]}`}
      >
        Not assessed
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold uppercase tracking-wide ${SIZE_CLASS[size]} ${RISK_BADGE_CLASS[level]}`}
    >
      <span className="sr-only">Risk level: </span>
      {level}
    </span>
  );
}

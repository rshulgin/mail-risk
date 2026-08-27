import type { RiskLevel } from '@mri/shared';

/**
 * Tailwind scans source for *literal* class strings, so risk classes must be
 * written out in full rather than built with template literals. One map, used
 * everywhere a risk level is rendered.
 */
export const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  none: 'bg-risk-none-bg text-risk-none border-risk-none-border',
  low: 'bg-risk-low-bg text-risk-low border-risk-low-border',
  medium: 'bg-risk-medium-bg text-risk-medium border-risk-medium-border',
  high: 'bg-risk-high-bg text-risk-high border-risk-high-border',
};

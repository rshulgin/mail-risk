import { RISK_LEVELS, type RiskLevel } from '@mri/shared';
import type { EmailFilters } from '../api/types.js';

/**
 * Search and a risk floor. Deliberately two controls rather than a filter
 * drawer: with ten to a few dozen emails, anything more is furniture.
 */
export function Filters({
  filters,
  onChange,
}: {
  filters: EmailFilters;
  onChange(filters: EmailFilters): void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <label htmlFor="search" className="sr-only">
          Search emails
        </label>
        <input
          id="search"
          type="search"
          value={filters.q ?? ''}
          placeholder="Search sender, subject or summary"
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
          className="border-line bg-surface w-full rounded-md border px-3 py-1.5 text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="min-risk" className="text-ink-muted text-xs font-medium">
          Minimum risk
        </label>
        <select
          id="min-risk"
          value={filters.minRisk ?? ''}
          onChange={(event) =>
            onChange({
              ...filters,
              minRisk: (event.target.value || undefined) as RiskLevel | undefined,
            })
          }
          className="border-line bg-surface rounded-md border px-2 py-1 text-sm"
        >
          <option value="">Any</option>
          {RISK_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

import { RISK_LEVELS } from '@mri/shared';
import { RISK_BADGE_CLASS } from './risk-styles.js';

/**
 * Slice 0 placeholder. It exists to prove three things wire up correctly:
 * React renders, the `@mri/shared` workspace import resolves, and Tailwind v4
 * generates utilities from the risk tokens in index.css.
 */
export function App() {
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Mail Risk Intelligence
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          Scaffold up. Inbox, pipeline and graph arrive in later slices.
        </p>
      </header>

      <section aria-labelledby="tokens-heading" className="flex flex-col gap-3">
        <h2 id="tokens-heading" className="text-sm font-medium">
          Risk tokens
        </h2>
        <ul className="flex flex-wrap gap-2">
          {RISK_LEVELS.map((level) => (
            <li key={level}>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium capitalize ${RISK_BADGE_CLASS[level]}`}
              >
                {level}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

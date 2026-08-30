import { useEffect } from 'react';
import { useMailbox } from './store/mailbox.js';
import { Filters } from './components/Filters.js';
import { InboxList } from './components/InboxList.js';
import { IngestForm } from './components/IngestForm.js';
import { EmailDetail } from './components/EmailDetail.js';
import { ProviderBanner } from './components/ProviderBanner.js';
import { EmptyState, ErrorState, LoadingState } from './components/States.js';

/**
 * Master-detail, collapsing to a single column below `md`.
 *
 * On narrow viewports the list and the detail are mutually exclusive rather
 * than stacked: selecting an email swaps the view and the detail offers a back
 * button, which is the behaviour a phone user expects from a mailbox.
 */
export function App() {
  const {
    emails,
    listStatus,
    listError,
    selectedId,
    detail,
    detailStatus,
    detailError,
    filters,
    health,
    loadEmails,
    loadHealth,
    select,
    setFilters,
    reprocess,
    stopPolling,
  } = useMailbox();

  useEffect(() => {
    void loadHealth();
    void loadEmails();
    return () => stopPolling();
  }, [loadEmails, loadHealth, stopPolling]);

  const hasSelection = selectedId !== null;

  return (
    <div className="flex h-full flex-col">
      <header className="border-line bg-surface border-b px-4 py-3 sm:px-6">
        <h1 className="text-base font-semibold tracking-tight">Mail Risk Intelligence</h1>
        <p className="text-ink-muted text-xs">Extraction, risk assessment and entity graph</p>
      </header>

      <ProviderBanner health={health} />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Inbox */}
        <section
          aria-label="Inbox"
          className={`border-line flex min-h-0 flex-col md:w-96 md:shrink-0 md:border-r ${
            hasSelection ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="border-line bg-surface-muted flex flex-col gap-2 border-b p-3">
            <Filters filters={filters} onChange={(next) => void setFilters(next)} />
            <IngestForm onAdded={(id) => void select(id)} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {listStatus === 'loading' && emails.length === 0 && <LoadingState label="Loading inbox…" />}

            {listStatus === 'error' && (
              <ErrorState message={listError ?? 'Could not load the inbox.'} onRetry={() => void loadEmails()} />
            )}

            {listStatus === 'ready' && emails.length === 0 && (
              <EmptyState
                title={
                  filters.q || filters.minRisk ? 'No emails match those filters' : 'The mailbox is empty'
                }
                description={
                  filters.q || filters.minRisk
                    ? 'Try clearing the search or lowering the minimum risk.'
                    : 'Add an email above to run it through the pipeline.'
                }
              />
            )}

            {emails.length > 0 && (
              <InboxList
                emails={emails}
                selectedId={selectedId}
                onSelect={(id) => void select(id)}
              />
            )}
          </div>
        </section>

        {/* Detail */}
        <main
          aria-label="Email detail"
          className={`min-h-0 flex-1 overflow-y-auto ${hasSelection ? 'block' : 'hidden md:block'}`}
        >
          {!hasSelection && (
            <EmptyState
              title="No email selected"
              description="Choose an email from the inbox to see its extraction, risk rationale and entity graph."
            />
          )}

          {hasSelection && detailStatus === 'loading' && !detail && (
            <LoadingState label="Loading email…" />
          )}

          {hasSelection && detailStatus === 'error' && (
            <ErrorState
              message={detailError ?? 'Could not load that email.'}
              onRetry={() => void select(selectedId)}
            />
          )}

          {detail && (
            <EmailDetail
              email={detail}
              onReprocess={() => void reprocess(detail.id)}
              onBack={() => void select(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

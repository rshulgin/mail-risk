import { create } from 'zustand';
import type {
  EmailDetail,
  EmailFilters,
  EmailListItem,
  GraphEdge,
  GraphNode,
  Health,
} from '../api/types.js';
import { api, ApiClientError } from '../api/client.js';

/**
 * One store for the whole app.
 *
 * The pipeline is asynchronous, so the interesting behaviour here is polling:
 * the list refreshes on a timer, but *only* while something is actually
 * pending or processing. An idle mailbox makes no requests at all.
 */

const POLL_INTERVAL_MS = 2_000;

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error';
export type View = 'inbox' | 'graph';

interface MailboxState {
  emails: EmailListItem[];
  listStatus: AsyncStatus;
  listError: string | null;

  selectedId: string | null;
  detail: EmailDetail | null;
  detailStatus: AsyncStatus;
  detailError: string | null;

  filters: EmailFilters;
  health: Health | null;

  submitting: boolean;
  submitError: string | null;

  view: View;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  graphStatus: AsyncStatus;
  graphError: string | null;

  setView(view: View): void;
  loadGraph(): Promise<void>;
  openEmailFromGraph(id: string): Promise<void>;
  loadHealth(): Promise<void>;
  loadEmails(): Promise<void>;
  select(id: string | null): Promise<void>;
  setFilters(filters: EmailFilters): Promise<void>;
  submitText(text: string): Promise<EmailDetail | null>;
  submitFile(file: File): Promise<EmailDetail | null>;
  reprocess(id: string): Promise<void>;
  clearSubmitError(): void;

  startPolling(): void;
  stopPolling(): void;
}

const messageOf = (error: unknown): string =>
  error instanceof ApiClientError ? error.message : 'Something went wrong.';

/** True while any email still has work queued or in flight. */
export const hasWorkInFlight = (emails: readonly EmailListItem[]): boolean =>
  emails.some((email) => email.status === 'pending' || email.status === 'processing');

export const useMailbox = create<MailboxState>((set, get) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Refresh in place: keeps the current selection and avoids a loading flash. */
  const refresh = async (): Promise<void> => {
    try {
      const [{ emails }, health] = await Promise.all([api.listEmails(get().filters), api.health()]);
      set({ emails, health, listStatus: 'ready', listError: null });

      const selectedId = get().selectedId;
      if (selectedId) {
        const detail = await api.getEmail(selectedId);
        set({ detail, detailStatus: 'ready' });
      }

      if (get().view === 'graph') await get().loadGraph();
      if (!hasWorkInFlight(emails)) get().stopPolling();
    } catch {
      // A failed poll is not worth destroying a working screen over; the next
      // tick may well succeed. Errors are surfaced by explicit loads instead.
    }
  };

  return {
    emails: [],
    listStatus: 'idle',
    listError: null,
    selectedId: null,
    detail: null,
    detailStatus: 'idle',
    detailError: null,
    filters: {},
    health: null,
    submitting: false,
    submitError: null,
    view: 'inbox',
    graph: null,
    graphStatus: 'idle',
    graphError: null,

    setView(view) {
      set({ view });
      if (view === 'graph') void get().loadGraph();
    },

    async loadGraph() {
      set({ graphStatus: 'loading', graphError: null });
      try {
        set({ graph: await api.graph(get().filters.minRisk), graphStatus: 'ready' });
      } catch (error) {
        set({ graphStatus: 'error', graphError: messageOf(error) });
      }
    },

    /** Jump from a graph node straight to one of the emails it appears in. */
    async openEmailFromGraph(id) {
      set({ view: 'inbox' });
      await get().select(id);
    },

    async loadHealth() {
      try {
        set({ health: await api.health() });
      } catch {
        set({ health: null });
      }
    },

    async loadEmails() {
      set({ listStatus: 'loading', listError: null });
      try {
        const { emails } = await api.listEmails(get().filters);
        set({ emails, listStatus: 'ready' });
        if (hasWorkInFlight(emails)) get().startPolling();
      } catch (error) {
        set({ listStatus: 'error', listError: messageOf(error) });
      }
    },

    async select(id) {
      if (!id) {
        set({ selectedId: null, detail: null, detailStatus: 'idle', detailError: null });
        return;
      }

      set({ selectedId: id, detailStatus: 'loading', detailError: null });
      try {
        set({ detail: await api.getEmail(id), detailStatus: 'ready' });
      } catch (error) {
        set({ detailStatus: 'error', detailError: messageOf(error) });
      }
    },

    async setFilters(filters) {
      set({ filters });
      await get().loadEmails();
    },

    async submitText(text) {
      set({ submitting: true, submitError: null });
      try {
        const created = await api.createFromText(text);
        set({ submitting: false });
        await get().loadEmails();
        get().startPolling();
        return created;
      } catch (error) {
        set({ submitting: false, submitError: messageOf(error) });
        return null;
      }
    },

    async submitFile(file) {
      set({ submitting: true, submitError: null });
      try {
        const created = await api.createFromFile(file);
        set({ submitting: false });
        await get().loadEmails();
        get().startPolling();
        return created;
      } catch (error) {
        set({ submitting: false, submitError: messageOf(error) });
        return null;
      }
    },

    async reprocess(id) {
      try {
        const updated = await api.reprocess(id);
        set((state) => ({ detail: state.selectedId === id ? updated : state.detail }));
        await get().loadEmails();
        get().startPolling();
      } catch (error) {
        set({ detailError: messageOf(error) });
      }
    },

    clearSubmitError() {
      set({ submitError: null });
    },

    startPolling() {
      if (timer) return;
      timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    },

    stopPolling() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
});

export { POLL_INTERVAL_MS };

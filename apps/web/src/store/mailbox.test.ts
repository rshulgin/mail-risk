import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasWorkInFlight, useMailbox } from './mailbox.js';
import { api, ApiClientError } from '../api/client.js';
import type { EmailDetail, EmailListItem } from '../api/types.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    api: {
      health: vi.fn(),
      listEmails: vi.fn(),
      getEmail: vi.fn(),
      createFromText: vi.fn(),
      createFromFile: vi.fn(),
      reprocess: vi.fn(),
      graph: vi.fn(),
    },
  };
});

const mocked = vi.mocked(api);

const listItem = (overrides: Partial<EmailListItem> = {}): EmailListItem => ({
  id: 'e1',
  externalId: 'E001',
  source: 'seed',
  from: 'a@b.com',
  to: ['c@d.com'],
  subject: 'Test',
  sentAt: '2026-06-02T08:14:00Z',
  receivedAt: '2026-06-02T08:14:00Z',
  status: 'completed',
  summary: 'A summary.',
  risk: { level: 'high', tags: ['urgency'] },
  attachmentCount: 0,
  ...overrides,
});

const detail = (overrides: Partial<EmailDetail> = {}): EmailDetail =>
  ({
    ...listItem(),
    rawText: 'raw',
    attachments: [],
    extraction: null,
    risk: { level: 'high', tags: [], rationale: 'because', confidence: 0.9 },
    run: null,
    entities: [],
    relationships: [],
    ...overrides,
  }) as EmailDetail;

const reset = () =>
  useMailbox.setState({
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
  });

describe('hasWorkInFlight', () => {
  it('is true while anything is pending or processing', () => {
    expect(hasWorkInFlight([listItem({ status: 'pending' })])).toBe(true);
    expect(hasWorkInFlight([listItem({ status: 'processing' })])).toBe(true);
  });

  it('is false once everything has settled, degraded and failed included', () => {
    expect(
      hasWorkInFlight([
        listItem({ status: 'completed' }),
        listItem({ status: 'degraded' }),
        listItem({ status: 'failed' }),
      ]),
    ).toBe(false);
  });
});

describe('mailbox store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMailbox.getState().stopPolling();
    reset();
  });

  it('loads the inbox', async () => {
    mocked.listEmails.mockResolvedValue({ emails: [listItem()], total: 1 });

    await useMailbox.getState().loadEmails();

    expect(useMailbox.getState().listStatus).toBe('ready');
    expect(useMailbox.getState().emails).toHaveLength(1);
  });

  it('surfaces a readable message when the API is unreachable', async () => {
    mocked.listEmails.mockRejectedValue(
      new ApiClientError('Could not reach the API. Is the server running?', 'network_error', 0),
    );

    await useMailbox.getState().loadEmails();

    expect(useMailbox.getState().listStatus).toBe('error');
    expect(useMailbox.getState().listError).toContain('Could not reach the API');
  });

  it('does not poll when everything has settled', async () => {
    mocked.listEmails.mockResolvedValue({ emails: [listItem({ status: 'completed' })], total: 1 });
    const spy = vi.spyOn(globalThis, 'setInterval');

    await useMailbox.getState().loadEmails();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('polls while work is in flight', async () => {
    mocked.listEmails.mockResolvedValue({ emails: [listItem({ status: 'pending' })], total: 1 });
    const spy = vi.spyOn(globalThis, 'setInterval');

    await useMailbox.getState().loadEmails();

    expect(spy).toHaveBeenCalled();
    useMailbox.getState().stopPolling();
    spy.mockRestore();
  });

  it('loads a detail on select and clears it on deselect', async () => {
    mocked.getEmail.mockResolvedValue(detail());

    await useMailbox.getState().select('e1');
    expect(useMailbox.getState().detail?.id).toBe('e1');
    expect(useMailbox.getState().detailStatus).toBe('ready');

    await useMailbox.getState().select(null);
    expect(useMailbox.getState().detail).toBeNull();
    expect(useMailbox.getState().selectedId).toBeNull();
  });

  it('reports a failed detail load without wiping the inbox', async () => {
    useMailbox.setState({ emails: [listItem()] });
    mocked.getEmail.mockRejectedValue(new ApiClientError('Email not found', 'not_found', 404));

    await useMailbox.getState().select('missing');

    expect(useMailbox.getState().detailStatus).toBe('error');
    expect(useMailbox.getState().detailError).toBe('Email not found');
    expect(useMailbox.getState().emails).toHaveLength(1);
  });

  it('keeps a submit error visible and does not clear the textarea', async () => {
    mocked.createFromText.mockRejectedValue(
      new ApiClientError('Email text is empty.', 'bad_request', 400),
    );

    const result = await useMailbox.getState().submitText('   ');

    expect(result).toBeNull();
    expect(useMailbox.getState().submitError).toBe('Email text is empty.');
    expect(useMailbox.getState().submitting).toBe(false);
  });

  it('refreshes the list after a successful submit', async () => {
    mocked.createFromText.mockResolvedValue(detail({ id: 'new' }));
    mocked.listEmails.mockResolvedValue({ emails: [listItem({ id: 'new' })], total: 1 });

    const created = await useMailbox.getState().submitText('From: a@b.com\n\nhi');

    expect(created?.id).toBe('new');
    expect(mocked.listEmails).toHaveBeenCalled();
    useMailbox.getState().stopPolling();
  });

  it('applies filters and reloads', async () => {
    mocked.listEmails.mockResolvedValue({ emails: [], total: 0 });

    await useMailbox.getState().setFilters({ minRisk: 'high', q: 'wire' });

    expect(useMailbox.getState().filters).toEqual({ minRisk: 'high', q: 'wire' });
    expect(mocked.listEmails).toHaveBeenCalledWith({ minRisk: 'high', q: 'wire' });
  });
});

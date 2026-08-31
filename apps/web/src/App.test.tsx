import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { useMailbox } from './store/mailbox.js';
import { api, ApiClientError } from './api/client.js';
import type { EmailDetail, EmailListItem, Health } from './api/types.js';

vi.mock('./api/client.js', async () => {
  const actual = await vi.importActual<typeof import('./api/client.js')>('./api/client.js');
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

const HEALTH: Health = {
  status: 'ok',
  provider: { name: 'ollama', model: 'llama3.2:3b', degraded: false, fallbackReason: null },
  queue: { waiting: 0, inFlight: 0, concurrency: 2 },
  counts: { emails: 1, entities: 3, pending: 0, processing: 0 },
};

const ITEM: EmailListItem = {
  id: 'e1',
  externalId: 'E001',
  source: 'seed',
  from: 'j.harrington-ceo@arclne-corp.com',
  to: ['finance-ops@arcline.com'],
  subject: 'URGENT - confidential wire needed',
  sentAt: '2026-06-02T08:14:00Z',
  receivedAt: '2026-06-02T08:14:00Z',
  status: 'completed',
  summary: 'Wire request.',
  risk: { level: 'high', tags: ['urgency'] },
  attachmentCount: 0,
};

const DETAIL: EmailDetail = {
  ...ITEM,
  rawText: 'Wire $184,500 today.',
  attachments: [],
  extraction: {
    sender: ITEM.from,
    recipients: ITEM.to,
    date: ITEM.sentAt ?? '',
    subject: ITEM.subject,
    summary: 'Asks Finance to wire $184,500.',
    facts: [{ kind: 'amount', value: '$184,500', context: 'requested wire' }],
  },
  risk: { level: 'high', tags: ['urgency'], rationale: 'Classic BEC pattern.', confidence: 0.9 },
  run: {
    id: 'r1',
    provider: 'ollama',
    model: 'llama3.2:3b',
    status: 'completed',
    startedAt: '2026-06-02T08:15:00Z',
    finishedAt: '2026-06-02T08:15:30Z',
    durationMs: 30_000,
    degradedReason: null,
    error: null,
  },
  entities: [
    { id: 'n1', type: 'person', name: 'James Harrington', surfaceForm: 'James Harrington', context: 'sender' },
  ],
  relationships: [],
};

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMailbox.getState().stopPolling();
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
  });

  it('loads the inbox and shows the empty detail prompt', async () => {
    mocked.health.mockResolvedValue(HEALTH);
    mocked.listEmails.mockResolvedValue({ emails: [ITEM], total: 1 });

    render(<App />);

    expect(await screen.findByText('URGENT - confidential wire needed')).toBeInTheDocument();
    expect(screen.getByText('No email selected')).toBeInTheDocument();
    expect(screen.getByText('ollama/llama3.2:3b')).toBeInTheDocument();
  });

  it('opens an email and renders its rationale and entities', async () => {
    mocked.health.mockResolvedValue(HEALTH);
    mocked.listEmails.mockResolvedValue({ emails: [ITEM], total: 1 });
    mocked.getEmail.mockResolvedValue(DETAIL);

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /URGENT/ }));

    expect(await screen.findByText('Classic BEC pattern.')).toBeInTheDocument();
    expect(screen.getByText('James Harrington')).toBeInTheDocument();
    expect(screen.getByText('Asks Finance to wire $184,500.')).toBeInTheDocument();
    // Provenance is always on screen next to the verdict.
    expect(screen.getByText(/ollama\/llama3\.2:3b · 30\.0s · confidence 90%/)).toBeInTheDocument();
  });

  it('returns to the inbox from the detail back button', async () => {
    mocked.health.mockResolvedValue(HEALTH);
    mocked.listEmails.mockResolvedValue({ emails: [ITEM], total: 1 });
    mocked.getEmail.mockResolvedValue(DETAIL);

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /URGENT/ }));
    await screen.findByText('Classic BEC pattern.');

    await userEvent.click(screen.getByRole('button', { name: /Back to inbox/ }));

    expect(await screen.findByText('No email selected')).toBeInTheDocument();
  });

  it('shows a retryable error when the API is down, then recovers', async () => {
    mocked.health.mockResolvedValue(HEALTH);
    mocked.listEmails.mockRejectedValueOnce(
      new ApiClientError('Could not reach the API. Is the server running?', 'network_error', 0),
    );

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the API');

    mocked.listEmails.mockResolvedValue({ emails: [ITEM], total: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('URGENT - confidential wire needed')).toBeInTheDocument();
  });

  it('distinguishes an empty mailbox from an empty filter result', async () => {
    mocked.health.mockResolvedValue(HEALTH);
    mocked.listEmails.mockResolvedValue({ emails: [], total: 0 });

    render(<App />);
    expect(await screen.findByText('The mailbox is empty')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search emails'), 'zzz');

    await waitFor(() =>
      expect(screen.getByText('No emails match those filters')).toBeInTheDocument(),
    );
  });

  it('adds a pasted email and selects it', async () => {
    mocked.health.mockResolvedValue(HEALTH);
    mocked.listEmails.mockResolvedValue({ emails: [], total: 0 });
    mocked.createFromText.mockResolvedValue({ ...DETAIL, status: 'pending', risk: null });
    mocked.getEmail.mockResolvedValue({ ...DETAIL, status: 'pending', risk: null });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add email' }));
    await userEvent.type(screen.getByLabelText('Paste raw email'), 'From: a@b.com\n\nhello');
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }));

    await waitFor(() => expect(mocked.createFromText).toHaveBeenCalled());
    expect(await screen.findByText(/Analysing this email/)).toBeInTheDocument();

    useMailbox.getState().stopPolling();
  });

  it('keeps the form open and shows why when a submission is rejected', async () => {
    mocked.health.mockResolvedValue(HEALTH);
    mocked.listEmails.mockResolvedValue({ emails: [], total: 0 });
    mocked.createFromText.mockRejectedValue(
      new ApiClientError('Email text is empty.', 'bad_request', 400),
    );

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add email' }));
    await userEvent.type(screen.getByLabelText('Paste raw email'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }));

    expect(await screen.findByText('Email text is empty.')).toBeInTheDocument();
    // The draft survives, so the user does not lose what they typed.
    expect(screen.getByLabelText('Paste raw email')).toHaveValue('x');
  });

  it('warns when assessments came from rules rather than a model', async () => {
    mocked.health.mockResolvedValue({
      ...HEALTH,
      provider: {
        name: 'rules',
        model: 'heuristic-v1',
        degraded: true,
        fallbackReason: 'Ollama is not reachable at http://127.0.0.1:11434',
      },
    });
    mocked.listEmails.mockResolvedValue({ emails: [ITEM], total: 1 });

    render(<App />);

    expect(await screen.findByText(/Rule-based mode/)).toBeInTheDocument();
    expect(screen.getByText(/not a model/)).toBeInTheDocument();
  });
});

describe('graph view', () => {
  beforeEach(() => {
    mocked.health.mockResolvedValue(HEALTH);
    mocked.listEmails.mockResolvedValue({ emails: [ITEM], total: 1 });
  });

  it('loads the graph when switched to, and lists entities accessibly', async () => {
    mocked.graph.mockResolvedValue({
      nodes: [
        { id: 'n1', type: 'organization', name: 'Northgate Suppliers', mentionCount: 3, emailIds: ['e1', 'e2'], highestRisk: 'high' },
        { id: 'n2', type: 'organization', name: 'Arcline', mentionCount: 8, emailIds: ['e1'], highestRisk: 'medium' },
      ],
      edges: [
        { id: 'n1|invoices|n2', source: 'n1', target: 'n2', type: 'invoices', evidence: '', emailIds: ['e1'] },
      ],
    });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'graph' }));

    // The canvas is aria-hidden, so the list is the accessible route in.
    expect(await screen.findByRole('button', { name: /Northgate Suppliers/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Arcline/ })).toBeInTheDocument();
  });

  it('selecting an entity shows its connections and a way into the email', async () => {
    mocked.graph.mockResolvedValue({
      nodes: [
        { id: 'n1', type: 'organization', name: 'Northgate Suppliers', mentionCount: 3, emailIds: ['e1'], highestRisk: 'high' },
        { id: 'n2', type: 'organization', name: 'Arcline', mentionCount: 8, emailIds: ['e1'], highestRisk: 'medium' },
      ],
      edges: [
        { id: 'n1|invoices|n2', source: 'n1', target: 'n2', type: 'invoices', evidence: '', emailIds: ['e1'] },
      ],
    });
    mocked.getEmail.mockResolvedValue(DETAIL);

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'graph' }));
    await userEvent.click(await screen.findByRole('button', { name: /Northgate Suppliers/ }));

    expect(await screen.findByText('Connections')).toBeInTheDocument();
    expect(screen.getByText(/invoices/)).toBeInTheDocument();
    expect(screen.getByText(/Seen in 1 email/)).toBeInTheDocument();

    // And the graph is a route back into the mailbox.
    await userEvent.click(screen.getByRole('button', { name: 'Open email' }));
    expect(await screen.findByText('Classic BEC pattern.')).toBeInTheDocument();
  });

  it('explains an empty graph rather than showing a blank canvas', async () => {
    mocked.graph.mockResolvedValue({ nodes: [], edges: [] });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'graph' }));

    expect(await screen.findByText('No graph yet')).toBeInTheDocument();
  });

  it('offers a retry when the graph fails to load', async () => {
    mocked.graph.mockRejectedValueOnce(
      new ApiClientError('Could not reach the API. Is the server running?', 'network_error', 0),
    );

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'graph' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the API');
  });
});

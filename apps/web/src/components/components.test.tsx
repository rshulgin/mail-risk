import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RiskBadge } from './RiskBadge.js';
import { StatusChip } from './StatusChip.js';
import { ProviderBanner } from './ProviderBanner.js';
import { InboxList } from './InboxList.js';
import { EntitiesPanel } from './EntitiesPanel.js';
import { EmptyState, ErrorState } from './States.js';
import type { EmailListItem, Health } from '../api/types.js';

const health = (overrides: Partial<Health['provider']> = {}): Health => ({
  status: 'ok',
  provider: { name: 'ollama', model: 'llama3.2:3b', degraded: false, fallbackReason: null, ...overrides },
  queue: { waiting: 0, inFlight: 0, concurrency: 2 },
  counts: { emails: 10, entities: 23, pending: 0, processing: 0 },
});

const item = (overrides: Partial<EmailListItem> = {}): EmailListItem => ({
  id: 'e1',
  externalId: 'E001',
  source: 'seed',
  from: '"James Harrington" <j.harrington-ceo@arclne-corp.com>',
  to: ['finance-ops@arcline.com'],
  subject: 'URGENT - confidential wire needed',
  sentAt: '2026-06-02T08:14:00Z',
  receivedAt: '2026-06-02T08:14:00Z',
  status: 'completed',
  summary: 'Wire request.',
  risk: { level: 'high', tags: ['urgency'] },
  attachmentCount: 0,
  ...overrides,
});

describe('RiskBadge', () => {
  it('states the level in text, not colour alone', () => {
    render(<RiskBadge level="high" />);
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Risk level:')).toBeInTheDocument();
  });

  it('distinguishes "not assessed" from "none"', () => {
    const { rerender } = render(<RiskBadge level={null} />);
    expect(screen.getByText('Not assessed')).toBeInTheDocument();

    rerender(<RiskBadge level="none" />);
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(screen.queryByText('Not assessed')).not.toBeInTheDocument();
  });
});

describe('StatusChip', () => {
  it('says nothing for a cleanly completed email', () => {
    const { container } = render(<StatusChip status="completed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the states that need explaining', () => {
    const { rerender } = render(<StatusChip status="processing" />);
    expect(screen.getByText('Analysing')).toBeInTheDocument();

    rerender(<StatusChip status="degraded" />);
    expect(screen.getByText('Partial')).toBeInTheDocument();

    rerender(<StatusChip status="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});

describe('ProviderBanner', () => {
  it('names the model when one is in use', () => {
    render(<ProviderBanner health={health()} />);
    expect(screen.getByText('ollama/llama3.2:3b')).toBeInTheDocument();
  });

  it('says plainly when results came from rules, not a model', () => {
    render(
      <ProviderBanner
        health={health({
          name: 'rules',
          model: 'heuristic-v1',
          degraded: true,
          fallbackReason: 'Ollama is not reachable at http://127.0.0.1:11434',
        })}
      />,
    );

    expect(screen.getByText(/Rule-based mode/)).toBeInTheDocument();
    expect(screen.getByText(/not a model/)).toBeInTheDocument();
    expect(screen.getByText(/Ollama is not reachable/)).toBeInTheDocument();
  });

  it('renders nothing before health has loaded', () => {
    const { container } = render(<ProviderBanner health={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('InboxList', () => {
  it('renders rows as buttons and reports the selection', async () => {
    const onSelect = vi.fn();
    render(<InboxList emails={[item()]} selectedId={null} onSelect={onSelect} />);

    const row = screen.getByRole('button', { name: /URGENT/ });
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('e1');
  });

  it('shows the address rather than the display name', () => {
    render(<InboxList emails={[item()]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('j.harrington-ceo@arclne-corp.com')).toBeInTheDocument();
  });

  it('marks the selected row for assistive technology', () => {
    render(<InboxList emails={[item()]} selectedId="e1" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /URGENT/ })).toHaveAttribute('aria-current', 'true');
  });

  it('handles an email with no subject and no assessment', () => {
    render(
      <InboxList
        emails={[item({ subject: '', risk: null, status: 'pending' })]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('No subject')).toBeInTheDocument();
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
});

describe('EntitiesPanel', () => {
  const entity = (id: string, type: 'person' | 'amount', name: string) => ({
    id,
    type,
    name,
    surfaceForm: name,
    context: '',
  });

  it('groups entities under their type', () => {
    render(
      <EntitiesPanel
        entities={[entity('1', 'person', 'James Harrington'), entity('2', 'amount', '$184,500')]}
        relationships={[]}
      />,
    );

    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('James Harrington')).toBeInTheDocument();
    expect(screen.getByText('Amounts')).toBeInTheDocument();
  });

  it('renders an unfamiliar relationship type rather than dropping it', () => {
    render(
      <EntitiesPanel
        entities={[entity('1', 'person', 'A'), entity('2', 'person', 'B')]}
        relationships={[
          {
            id: 'r1',
            type: 'some_unmapped_verb',
            evidence: '',
            source: { id: '1', name: 'A', type: 'person' },
            target: { id: '2', name: 'B', type: 'person' },
          },
        ]}
      />,
    );

    const list = screen.getByText(/some unmapped verb/);
    expect(list).toBeInTheDocument();
  });

  it('explains an empty extraction instead of rendering a blank box', () => {
    render(<EntitiesPanel entities={[]} relationships={[]} />);
    expect(screen.getByText('No entities extracted')).toBeInTheDocument();
  });

  it('notes when entities exist but no relationships were found', () => {
    render(<EntitiesPanel entities={[entity('1', 'person', 'A')]} relationships={[]} />);
    expect(screen.getByText(/No relationships were identified/)).toBeInTheDocument();
  });
});

describe('States', () => {
  it('exposes errors as an alert with a retry', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Could not reach the API." onRetry={onRetry} />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Could not reach the API.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders an empty state with guidance', () => {
    render(<EmptyState title="The mailbox is empty" description="Add an email above." />);
    expect(screen.getByText('The mailbox is empty')).toBeInTheDocument();
    expect(screen.getByText('Add an email above.')).toBeInTheDocument();
  });
});

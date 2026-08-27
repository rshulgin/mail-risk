import { describe, expect, it } from 'vitest';
import { renderEmailForAgent, seedEmailToRawEmail, rawEmailSchema } from './email.js';

describe('seed conversion', () => {
  it('maps snake_case attachment text into the domain shape', () => {
    const raw = seedEmailToRawEmail({
      id: 'E003',
      from: 'd.moreno@arcline.com',
      to: ['dmoreno.private@fastmail.com'],
      date: '2026-06-03T22:41:00Z',
      subject: 'fwd: Q3 roadmap',
      body: 'Forwarding these.',
      attachments: [{ filename: 'Q3.pdf', extracted_text: 'Meridian Corp renewal' }],
    });

    expect(raw.externalId).toBe('E003');
    expect(raw.attachments[0]?.extractedText).toBe('Meridian Corp renewal');
  });
});

describe('renderEmailForAgent', () => {
  it('inlines attachment text so the agent can see it', () => {
    const email = rawEmailSchema.parse({
      from: 'billing@northgate-suppliers.com',
      to: ['accounts-payable@arcline.com'],
      subject: 'Invoice #NS-4471',
      body: 'Please note updated payment details.',
      attachments: [
        { filename: 'invoice.pdf', extractedText: 'New account ending 9902' },
      ],
    });

    const rendered = renderEmailForAgent(email);
    expect(rendered).toContain('From: billing@northgate-suppliers.com');
    expect(rendered).toContain('Please note updated payment details.');
    expect(rendered).toContain('--- Attachment: invoice.pdf ---');
    expect(rendered).toContain('New account ending 9902');
  });

  it('omits the attachment block entirely when there are none', () => {
    const email = rawEmailSchema.parse({ from: 'a@b.com', body: 'hi' });
    expect(renderEmailForAgent(email)).not.toContain('Attachment');
  });
});

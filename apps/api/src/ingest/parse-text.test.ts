import { describe, expect, it } from 'vitest';
import { parseEmailText } from './parse-text.js';

describe('parseEmailText', () => {
  it('reads a pasted message with headers', () => {
    const email = parseEmailText(
      [
        'From: j.harrington-ceo@arclne-corp.com',
        'To: finance-ops@arcline.com, cfo@arcline.com',
        'Date: 2026-06-02T08:14:00Z',
        'Subject: URGENT - confidential wire needed',
        '',
        'Please wire $184,500 today.',
        'Do not loop anyone else in.',
      ].join('\n'),
    );

    expect(email.from).toBe('j.harrington-ceo@arclne-corp.com');
    expect(email.to).toEqual(['finance-ops@arcline.com', 'cfo@arcline.com']);
    expect(email.subject).toBe('URGENT - confidential wire needed');
    expect(email.body).toContain('Please wire $184,500 today.');
    expect(email.body).not.toContain('From:');
  });

  it('treats a bare paste as the body', () => {
    const email = parseEmailText('You people have wasted six months of my time.');
    expect(email.body).toBe('You people have wasted six months of my time.');
    expect(email.from).toBe('');
  });

  it('does not mistake body prose for headers', () => {
    // "Subject:" appears mid-body; the paste has no real header block.
    const raw = 'Hi team,\n\nSubject: this is discussed below\n\nRegards';
    const email = parseEmailText(raw);

    expect(email.subject).toBe('');
    expect(email.body).toContain('Subject: this is discussed below');
  });

  it('handles CRLF line endings', () => {
    const email = parseEmailText('From: a@b.com\r\nSubject: hi\r\n\r\nBody here.');
    expect(email.from).toBe('a@b.com');
    expect(email.body).toBe('Body here.');
  });

  it('survives an empty paste', () => {
    expect(parseEmailText('   ').body).toBe('');
  });
});

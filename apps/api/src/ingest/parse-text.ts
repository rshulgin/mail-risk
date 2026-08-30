import { rawEmailSchema, type RawEmail } from '@mri/shared';

/**
 * Parses pasted text into an email.
 *
 * Handles the two things people actually paste: a full message with headers,
 * and a bare body with no headers at all. The header block is only honoured
 * when the text genuinely starts with headers — otherwise a body that happens
 * to contain "Subject: ..." halfway down would be misread.
 */

const HEADER_LINE = /^([A-Za-z-]+):\s*(.*)$/;
const KNOWN_HEADERS = new Set(['from', 'to', 'cc', 'date', 'subject', 'sent', 'reply-to']);

const splitAddresses = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export function parseEmailText(raw: string): RawEmail {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return rawEmailSchema.parse({ body: '' });

  const lines = text.split('\n');
  const headers = new Map<string, string>();
  let bodyStart = 0;
  let sawHeader = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      // A blank line ends the header block — but only if we found one.
      if (sawHeader) {
        bodyStart = i + 1;
        break;
      }
      continue;
    }

    const match = HEADER_LINE.exec(line);
    const name = match?.[1]?.toLowerCase();

    if (match && name && KNOWN_HEADERS.has(name)) {
      headers.set(name, (match[2] ?? '').trim());
      sawHeader = true;
      bodyStart = i + 1;
      continue;
    }

    // First non-header line: everything from here is body.
    if (!sawHeader) bodyStart = 0;
    break;
  }

  const body = lines.slice(bodyStart).join('\n').trim();

  return rawEmailSchema.parse({
    from: headers.get('from') ?? '',
    to: splitAddresses(headers.get('to') ?? ''),
    date: headers.get('date') ?? headers.get('sent') ?? '',
    subject: headers.get('subject') ?? '',
    // With no headers at all, the whole paste is the body.
    body: sawHeader ? body : text,
    attachments: [],
  });
}

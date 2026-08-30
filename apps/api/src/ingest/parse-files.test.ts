import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.js';
import { parseUpload } from './index.js';
import { parseEml } from './parse-eml.js';
import { extractPdfText } from './parse-pdf.js';

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)));

const EML = [
  'From: "K. Dubois" <k.dubois.ext@partnerlogistics.com>',
  'To: s.pillai@arcline.com',
  'Subject: you will regret pulling out of this contract',
  'Date: Sat, 06 Jun 2026 14:55:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'You people have wasted six months of my time.',
].join('\r\n');

describe('parseEml', () => {
  it('pulls headers and body out of an .eml', async () => {
    const email = await parseEml(Buffer.from(EML));

    expect(email.from).toContain('k.dubois.ext@partnerlogistics.com');
    expect(email.to).toEqual(['s.pillai@arcline.com']);
    expect(email.subject).toBe('you will regret pulling out of this contract');
    expect(email.date).toBe('2026-06-06T14:55:00.000Z');
    expect(email.body).toContain('wasted six months');
  });

  it('does not let one unreadable attachment sink the email', async () => {
    const withAttachment = [
      'From: a@b.com',
      'To: c@d.com',
      'Subject: report',
      'Content-Type: multipart/mixed; boundary="X"',
      '',
      '--X',
      'Content-Type: text/plain',
      '',
      'See attached.',
      '--X',
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="broken.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'bm90IGEgcGRm',
      '--X--',
    ].join('\r\n');

    const email = await parseEml(Buffer.from(withAttachment), () => {
      throw new Error('not a pdf');
    });

    expect(email.body).toContain('See attached.');
    expect(email.attachments[0]?.filename).toBe('broken.pdf');
    expect(email.attachments[0]?.extractedText).toBe('');
  });
});

describe('extractPdfText', () => {
  it('extracts the text layer', async () => {
    const text = await extractPdfText(fixture('invoice.pdf'));
    expect(text).toContain('NS-4471');
    expect(text).toContain('9902');
  });
});

describe('parseUpload', () => {
  it('turns a bare PDF into an email carrying it as an attachment', async () => {
    const email = await parseUpload({
      originalname: 'invoice_NS-4471.pdf',
      mimetype: 'application/pdf',
      buffer: fixture('invoice.pdf'),
    });

    expect(email.subject).toBe('invoice_NS-4471');
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]?.extractedText).toContain('47,300');
  });

  it('parses a .txt upload as pasted text', async () => {
    const email = await parseUpload({
      originalname: 'note.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('From: x@y.com\nSubject: hi\n\nHello there.'),
    });
    expect(email.subject).toBe('hi');
  });

  it('rejects an unsupported extension with a helpful message', async () => {
    await expect(
      parseUpload({ originalname: 'malware.exe', mimetype: 'application/octet-stream', buffer: Buffer.from('x') }),
    ).rejects.toThrow(ApiError);

    await expect(
      parseUpload({ originalname: 'sheet.xlsx', mimetype: 'application/vnd.ms-excel', buffer: Buffer.from('x') }),
    ).rejects.toThrow(/Unsupported file type/);
  });

  it('rejects a PDF with no text layer rather than storing an empty email', async () => {
    // A valid-enough PDF header with no extractable text.
    await expect(
      parseUpload({
        originalname: 'scan.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
      }),
    ).rejects.toThrow();
  });
});

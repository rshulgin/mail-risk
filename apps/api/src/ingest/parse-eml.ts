import { simpleParser } from 'mailparser';
import { rawEmailSchema, type RawEmail } from '@mri/shared';

/**
 * Parses an RFC-822 `.eml` file.
 *
 * Attachment bodies are decoded to text where they plausibly are text; a PDF
 * attachment inside an .eml is handed to the PDF extractor so the invoice
 * numbers inside it reach the pipeline like any other attachment.
 */
export async function parseEml(
  buffer: Buffer,
  extractPdfText?: (data: Buffer) => Promise<string>,
): Promise<RawEmail> {
  const parsed = await simpleParser(buffer);

  const attachments: { filename: string; extractedText: string }[] = [];
  for (const attachment of parsed.attachments ?? []) {
    const filename = attachment.filename ?? 'attachment';
    const contentType = (attachment.contentType ?? '').toLowerCase();

    let extractedText = '';
    try {
      if (contentType.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) {
        extractedText = extractPdfText ? await extractPdfText(attachment.content) : '';
      } else if (contentType.startsWith('text/') || /\.(txt|csv|md|json)$/i.test(filename)) {
        extractedText = attachment.content.toString('utf8');
      }
    } catch {
      // A single unreadable attachment must not sink the whole email.
      extractedText = '';
    }

    attachments.push({ filename, extractedText });
  }

  const recipients = Array.isArray(parsed.to)
    ? parsed.to.flatMap((entry) => entry.value.map((v) => v.address ?? v.name))
    : (parsed.to?.value.map((v) => v.address ?? v.name) ?? []);

  return rawEmailSchema.parse({
    from: parsed.from?.text ?? '',
    to: recipients.filter(Boolean),
    date: parsed.date?.toISOString() ?? '',
    subject: parsed.subject ?? '',
    body: parsed.text ?? parsed.html ?? '',
    attachments,
  });
}

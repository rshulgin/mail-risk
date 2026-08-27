import { z } from 'zod';

/** Lifecycle of one email through the pipeline. */
export const EMAIL_STATUSES = [
  'pending',
  'processing',
  'completed',
  'degraded',
  'failed',
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export const emailStatusSchema = z.enum(EMAIL_STATUSES);

/** Where an email entered the system. Kept for provenance in the UI. */
export const EMAIL_SOURCES = ['seed', 'paste', 'upload'] as const;
export type EmailSource = (typeof EMAIL_SOURCES)[number];
export const emailSourceSchema = z.enum(EMAIL_SOURCES);

export const attachmentSchema = z.object({
  filename: z.string().min(1),
  /**
   * Seed data arrives with attachment text already extracted; uploaded PDFs go
   * through a parser in slice 3. Either way the pipeline only ever sees text.
   */
  extractedText: z.string().default(''),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/**
 * The normalised shape every ingestion path produces. Seed JSON, pasted text,
 * .eml and .pdf all converge here before anything else touches them.
 */
export const rawEmailSchema = z.object({
  externalId: z.string().min(1).optional(),
  from: z.string().default(''),
  to: z.array(z.string()).default([]),
  date: z.string().default(''),
  subject: z.string().default(''),
  body: z.string().default(''),
  attachments: z.array(attachmentSchema).default([]),
});
export type RawEmail = z.infer<typeof rawEmailSchema>;

/**
 * The exact shape of `mock_mailbox_data.json`. Kept separate from `RawEmail`
 * so the seed file's snake_case field names stay at the edge of the system.
 */
export const seedEmailSchema = z.object({
  id: z.string().min(1),
  from: z.string(),
  to: z.array(z.string()),
  date: z.string(),
  subject: z.string(),
  body: z.string(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        extracted_text: z.string().default(''),
      }),
    )
    .default([]),
});

export const seedCorpusSchema = z.object({ emails: z.array(seedEmailSchema) });
export type SeedEmail = z.infer<typeof seedEmailSchema>;

export function seedEmailToRawEmail(seed: SeedEmail): RawEmail {
  return {
    externalId: seed.id,
    from: seed.from,
    to: seed.to,
    date: seed.date,
    subject: seed.subject,
    body: seed.body,
    attachments: seed.attachments.map((a) => ({
      filename: a.filename,
      extractedText: a.extracted_text,
    })),
  };
}

/**
 * One flat text blob per email, used as the agent prompt input. Attachments are
 * inlined so Agent A sees the invoice body that carries the account numbers.
 */
export function renderEmailForAgent(email: RawEmail): string {
  const header = [
    `From: ${email.from}`,
    `To: ${email.to.join(', ')}`,
    `Date: ${email.date}`,
    `Subject: ${email.subject}`,
  ].join('\n');

  const attachments = email.attachments
    .map((a) => `--- Attachment: ${a.filename} ---\n${a.extractedText}`)
    .join('\n\n');

  return [header, '', email.body, attachments && `\n${attachments}`]
    .filter((part) => part !== '')
    .join('\n')
    .trim();
}

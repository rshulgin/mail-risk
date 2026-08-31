import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import {
  renderEmailForAgent,
  seedCorpusSchema,
  seedEmailToRawEmail,
  type EmailSource,
  type RawEmail,
} from '@mri/shared';
import { ApiError } from '../errors.js';
import type { Storage } from '../storage/index.js';
import type { EmailRecord } from '../storage/types.js';
import { parseEmailText } from './parse-text.js';
import { parseEml } from './parse-eml.js';
import { extractPdfText } from './parse-pdf.js';

/**
 * Every way an email can enter the system converges here.
 *
 * Each source is turned into a `RawEmail`, then stored identically — so a
 * pasted message, an uploaded `.eml` and a seeded fixture all flow through the
 * same pipeline, which is what the brief asks for.
 */

export const SUPPORTED_EXTENSIONS = ['.txt', '.eml', '.pdf'] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

/**
 * Stores a raw email. `rawText` is the flattened rendering the UI shows as
 * "original content" and the agents receive as input, so the two can never
 * disagree about what was actually assessed.
 */
function store(storage: Storage, email: RawEmail, source: EmailSource): EmailRecord {
  return storage.emails.insert({ email, rawText: renderEmailForAgent(email), source });
}

export async function parseUpload(file: UploadedFile): Promise<RawEmail> {
  const extension = extname(file.originalname).toLowerCase();

  switch (extension) {
    case '.eml':
      return parseEml(file.buffer, extractPdfText);

    case '.txt':
      return parseEmailText(file.buffer.toString('utf8'));

    case '.pdf': {
      const text = await extractPdfText(file.buffer);
      if (!text) {
        throw new ApiError(
          'unprocessable_content',
          'No text could be extracted from that PDF. Scanned documents need OCR, which is not supported.',
        );
      }
      // A bare PDF is not an email, so it becomes one: an email carrying the
      // document as its only attachment. The pipeline needs no special case.
      return {
        from: '',
        to: [],
        date: '',
        subject: basename(file.originalname, '.pdf'),
        body: '',
        attachments: [{ filename: basename(file.originalname), extractedText: text }],
      };
    }

    default:
      throw new ApiError(
        'unsupported_media_type',
        `Unsupported file type "${extension || file.originalname}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
      );
  }
}

export function createIngestService(storage: Storage) {
  return {
    /** Pasted raw text. */
    fromText(raw: string): EmailRecord {
      const trimmed = raw.trim();
      if (!trimmed) throw ApiError.badRequest('Email text is empty.');
      return store(storage, parseEmailText(trimmed), 'paste');
    },

    async fromUpload(file: UploadedFile): Promise<EmailRecord> {
      const email = await parseUpload(file);
      const hasContent =
        email.body.trim() !== '' || email.attachments.some((a) => a.extractedText.trim() !== '');
      if (!hasContent) {
        throw new ApiError(
          'unprocessable_content',
          `"${file.originalname}" contained no readable text.`,
        );
      }
      return store(storage, email, 'upload');
    },

    /**
     * Loads the seed corpus. Idempotent through the `externalId` uniqueness
     * constraint, so restarting the server re-enqueues nothing already stored.
     */
    seed(path: string): { inserted: EmailRecord[]; skipped: number } {
      const corpus = seedCorpusSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      const inserted: EmailRecord[] = [];
      let skipped = 0;

      // Chronological, not file order. The pipeline builds cross-email context
      // as it goes, so an email must be processed after the ones that precede
      // it in time — otherwise E004 (a redirected invoice, 4 June) is assessed
      // before E009 (the legitimate invoice from the same vendor, 4 May) has
      // established which account was actually on file. File order would make
      // that history arrive too late to be useful.
      const chronological = [...corpus.emails].sort((a, b) =>
        (a.date || '').localeCompare(b.date || ''),
      );

      for (const seed of chronological) {
        if (storage.emails.findByExternalId(seed.id)) {
          skipped += 1;
          continue;
        }
        inserted.push(store(storage, seedEmailToRawEmail(seed), 'seed'));
      }

      return { inserted, skipped };
    },
  };
}

export type IngestService = ReturnType<typeof createIngestService>;
export { parseEmailText } from './parse-text.js';
export { parseEml } from './parse-eml.js';
export { extractPdfText } from './parse-pdf.js';

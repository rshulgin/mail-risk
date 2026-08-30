import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Extracts text from a PDF.
 *
 * `unpdf` wraps pdf.js and works in plain ESM without a build step, which the
 * commonly-suggested `pdf-parse` does not. Scanned PDFs contain no text layer
 * and will legitimately come back empty — callers must treat "" as a valid
 * outcome, not an error.
 */
export async function extractPdfText(data: Buffer): Promise<string> {
  const document = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(document, { mergePages: true });
  return (Array.isArray(text) ? text.join('\n') : text).trim();
}

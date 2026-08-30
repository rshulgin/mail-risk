import { useRef, useState } from 'react';
import { useMailbox } from '../store/mailbox.js';

/**
 * Adds an email to the mailbox: paste raw text, or upload a .txt/.eml/.pdf.
 *
 * Both routes hit the same endpoint and therefore the same pipeline, which is
 * the point — a pasted message is not a second-class citizen next to a seeded
 * one.
 */
export function IngestForm({ onAdded }: { onAdded(id: string): void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const submitting = useMailbox((state) => state.submitting);
  const submitError = useMailbox((state) => state.submitError);
  const submitText = useMailbox((state) => state.submitText);
  const submitFile = useMailbox((state) => state.submitFile);
  const clearSubmitError = useMailbox((state) => state.clearSubmitError);

  const handleText = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;

    const created = await submitText(text);
    if (created) {
      setText('');
      setOpen(false);
      onAdded(created.id);
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const created = await submitFile(file);
    // Always reset, so re-picking the same file after a failure still fires.
    if (fileInput.current) fileInput.current.value = '';
    if (created) {
      setOpen(false);
      onAdded(created.id);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          clearSubmitError();
          setOpen(true);
        }}
        className="border-line bg-surface hover:bg-surface-muted w-full rounded-md border border-dashed px-3 py-2 text-sm font-medium"
      >
        + Add email
      </button>
    );
  }

  return (
    <form onSubmit={handleText} className="border-line bg-surface rounded-md border p-3">
      <label htmlFor="paste-email" className="text-xs font-semibold">
        Paste raw email
      </label>
      <textarea
        id="paste-email"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={6}
        placeholder={'From: someone@example.com\nSubject: …\n\nMessage body'}
        className="border-line mt-1.5 w-full resize-y rounded-md border p-2 font-mono text-xs"
      />

      {submitError && (
        <p role="alert" className="text-risk-high mt-2 text-xs">
          {submitError}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="bg-accent rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Analyse'}
        </button>

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={submitting}
          className="border-line hover:bg-surface-muted rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          Upload file
        </button>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            clearSubmitError();
          }}
          className="text-ink-muted px-1 text-sm"
        >
          Cancel
        </button>

        <input
          ref={fileInput}
          type="file"
          accept=".txt,.eml,.pdf"
          onChange={handleFile}
          className="sr-only"
          aria-label="Upload a .txt, .eml or .pdf file"
        />
      </div>

      <p className="text-ink-muted mt-2 text-[11px]">Accepts .txt, .eml or .pdf, up to 5MB.</p>
    </form>
  );
}

import { type SyntheticEvent, useRef, useState } from 'react';
import { track } from '../../lib/analytics/track';
import styles from './ApkgCsvExportForm.module.css';

type FormState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | {
      kind: 'success';
      deckName: string;
      noteCount: number;
      csvName: string;
      csvUrl: string;
    }
  // `capped` is deliberately separate from `error`. Hitting the note limit is a
  // gate, not a failure — it gets a neutral treatment and an obvious next step,
  // while red stays reserved for things that actually went wrong.
  | {
      kind: 'capped';
      noteCount: number;
      noteLimit: number;
      needsAccount: boolean;
    }
  | { kind: 'error'; message: string };

interface ServerError {
  message?: string;
  note_count?: number;
  note_limit?: number;
  requires_account?: boolean;
}

async function readCapExceeded(response: Response): Promise<{
  kind: 'capped';
  noteCount: number;
  noteLimit: number;
  needsAccount: boolean;
} | null> {
  if (response.status !== 402) return null;
  try {
    const body = (await response.clone().json()) as ServerError;
    if (body.note_count == null || body.note_limit == null) return null;
    return {
      kind: 'capped',
      noteCount: body.note_count,
      noteLimit: body.note_limit,
      needsAccount: body.requires_account === true,
    };
  } catch {
    return null;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as ServerError;
    if (typeof body.message === 'string' && body.message.length > 0) {
      return body.message;
    }
  } catch {
    // not JSON
  }
  if (response.status === 413)
    return 'This file is over the 100 MB upload limit.';
  return "Couldn't read this .apkg file. Pick another deck and try again.";
}

function readDeckName(headers: Headers, fallback: string): string {
  const disposition = headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (match) return decodeURIComponent(match[1]).replace(/\.csv$/i, '');
  const ascii = /filename="([^"]+)"/i.exec(disposition);
  if (ascii) return ascii[1].replace(/\.csv$/i, '');
  return fallback;
}

function readNoteCount(headers: Headers): number {
  const raw = headers.get('X-Card-Count') ?? '';
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function ApkgCsvExportForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const [state, setState] = useState<FormState>({ kind: 'idle' });
  const [filename, setFilename] = useState<string | null>(null);

  const onFileChange = () => {
    const f = inputRef.current?.files?.[0];
    setFilename(f?.name ?? null);
  };

  const triggerDownload = (url: string, name: string) => {
    if (!downloadRef.current) return;
    downloadRef.current.href = url;
    downloadRef.current.download = name;
    downloadRef.current.click();
  };

  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (file == null) {
      setState({ kind: 'error', message: 'Pick a .apkg file to export.' });
      return;
    }
    if (!/\.apkg$/i.test(file.name)) {
      setState({
        kind: 'error',
        message:
          'This file isn’t an .apkg. Export from Anki first, then upload that file.',
      });
      return;
    }
    setState({ kind: 'uploading' });
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await globalThis.fetch('/api/apkg/csv', {
        method: 'post',
        body: formData,
      });
      if (!response.ok) {
        const capped = await readCapExceeded(response);
        if (capped) {
          setState(capped);
          return;
        }
        const message = await readErrorMessage(response);
        setState({ kind: 'error', message });
        return;
      }
      const fallback = file.name.replace(/\.apkg$/i, '');
      const deckName = readDeckName(response.headers, fallback);
      const noteCount = readNoteCount(response.headers);
      const blob = await response.blob();
      const csvUrl = globalThis.URL.createObjectURL(blob);
      const csvName = `${deckName}.csv`;
      triggerDownload(csvUrl, csvName);
      track('apkg_csv_exported', { noteCount });
      setState({ kind: 'success', deckName, noteCount, csvName, csvUrl });
    } catch (error) {
      const message =
        error instanceof Error && /fetch|network/i.test(error.message)
          ? "Couldn't reach 2anki. Check your connection and try again."
          : "Couldn't export this deck. Try again, or email support@2anki.net.";
      setState({ kind: 'error', message });
    }
  };

  const showFileLabel =
    state.kind === 'idle' ||
    state.kind === 'error' ||
    state.kind === 'uploading';

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      aria-label="Export .apkg to CSV"
    >
      {showFileLabel && (
        <div className={styles.row}>
          <label htmlFor="apkg-csv-file" className={styles.fileLabel}>
            {filename ? 'Change file' : 'Choose .apkg file'}
            {filename && (
              <span className={styles.filenameInline} title={filename}>
                {filename}
              </span>
            )}
          </label>
          <input
            ref={inputRef}
            id="apkg-csv-file"
            type="file"
            accept=".apkg"
            className={styles.fileInput}
            onChange={onFileChange}
            required
          />
          <button
            type="submit"
            className={styles.submit}
            disabled={state.kind === 'uploading' || filename == null}
          >
            {state.kind === 'uploading'
              ? 'Exporting your CSV'
              : 'Export to CSV'}
          </button>
        </div>
      )}
      <p className={styles.helper}>
        Export up to 21 notes now, no account needed. A free account raises that
        to 100 per file — unlimited with a paid plan.
      </p>
      {state.kind === 'capped' && (
        <div className={styles.capNotice} role="status" aria-live="polite">
          <p className={styles.capHeadline}>
            This deck has {state.noteCount} notes.{' '}
            {state.needsAccount
              ? `Without an account you can export ${state.noteLimit}.`
              : `Your plan exports ${state.noteLimit} per file.`}
          </p>
          {state.needsAccount && (
            <p className={styles.capSubline}>
              Sign in free to export up to 100 per file.
            </p>
          )}
          <div className={styles.capActions}>
            {state.needsAccount && (
              <a
                className={styles.capPrimary}
                href="/login?redirect=/convert/apkg-to-csv"
              >
                Sign in to export
              </a>
            )}
            <a className={styles.capSecondary} href="/pricing">
              Upgrade for unlimited
            </a>
          </div>
        </div>
      )}
      {state.kind === 'error' && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'success' && (
        <>
          <p className={styles.success}>
            Exported {state.noteCount}{' '}
            {state.noteCount === 1 ? 'note' : 'notes'} — {state.deckName}.csv
            saved to your downloads
          </p>
          <button
            type="button"
            className={styles.downloadAgain}
            onClick={() => triggerDownload(state.csvUrl, state.csvName)}
          >
            Download again
          </button>
        </>
      )}
      <a hidden ref={downloadRef} aria-hidden="true">
        download
      </a>
    </form>
  );
}

export default ApkgCsvExportForm;

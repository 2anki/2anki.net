import { type SyntheticEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

async function readErrorMessage(
  response: Response,
  t: TFunction<'tools'>
): Promise<string> {
  try {
    const body = (await response.clone().json()) as ServerError;
    if (typeof body.message === 'string' && body.message.length > 0) {
      return body.message;
    }
  } catch {
    // not JSON
  }
  if (response.status === 413) return t('apkgCsv.tooBig');
  return t('apkgCsv.unreadable');
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
  const { t } = useTranslation('tools');
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
      setState({ kind: 'error', message: t('apkgCsv.pickFile') });
      return;
    }
    if (!/\.apkg$/i.test(file.name)) {
      setState({
        kind: 'error',
        message: t('apkgCsv.notApkg'),
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
        const message = await readErrorMessage(response, t);
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
          ? t('apkgCsv.networkError')
          : t('apkgCsv.genericError');
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
      aria-label={t('apkgCsv.formAria')}
    >
      {showFileLabel && (
        <div className={styles.row}>
          <label htmlFor="apkg-csv-file" className={styles.fileLabel}>
            {filename ? t('apkgCsv.changeFile') : t('apkgCsv.chooseFile')}
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
              ? t('apkgCsv.exporting')
              : t('apkgCsv.exportToCsv')}
          </button>
        </div>
      )}
      <p className={styles.helper}>{t('apkgCsv.helper')}</p>
      {state.kind === 'capped' && (
        <div className={styles.capNotice} role="status" aria-live="polite">
          <p className={styles.capHeadline}>
            {t('apkgCsv.capHas', { count: state.noteCount })}{' '}
            {state.needsAccount
              ? t('apkgCsv.capNoAccount', { limit: state.noteLimit })
              : t('apkgCsv.capPlan', { limit: state.noteLimit })}
          </p>
          {state.needsAccount && (
            <p className={styles.capSubline}>{t('apkgCsv.capSignInFree')}</p>
          )}
          <div className={styles.capActions}>
            {state.needsAccount && (
              <a
                className={styles.capPrimary}
                href="/login?redirect=/convert/apkg-to-csv"
              >
                {t('apkgCsv.signInToExport')}
              </a>
            )}
            <a className={styles.capSecondary} href="/pricing">
              {t('apkgCsv.upgradeUnlimited')}
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
            {t('apkgCsv.exportSuccess', {
              count: state.noteCount,
              deckName: state.deckName,
            })}
          </p>
          <button
            type="button"
            className={styles.downloadAgain}
            onClick={() => triggerDownload(state.csvUrl, state.csvName)}
          >
            {t('apkgCsv.downloadAgain')}
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

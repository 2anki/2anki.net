import { SyntheticEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import styles from './PrintForm.module.css';
import sharedStyles from '../../../styles/shared.module.css';
import { useDropZone } from '../../../lib/hooks/useDropZone';

type PrintState = 'idle' | 'uploading' | 'done' | 'error';
type PaperSize = 'A4' | 'Letter' | 'Legal';
type Orientation = 'portrait' | 'landscape';
type Margins = 'narrow' | 'normal' | 'wide';

interface PrintMessages {
  wrongType: string;
  corrupted: string;
  genericError: string;
  auth: string;
  upgrade: string;
}

const CARD_LIMIT_PATTERN = /PDF export supports up to/i;

function isApkgFile(name: string): boolean {
  return /\.apkg$/i.test(name);
}

async function extractErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const body = await response.clone().json();
    if (typeof body?.message === 'string' && body.message.trim().length > 0) {
      return body.message;
    }
  } catch {
    /* response not JSON */
  }
  return fallback;
}

function toUserMessage(
  serverMessage: string,
  status: number,
  messages: PrintMessages
): string {
  if (status === 401) return messages.auth;
  if (status === 402 || status === 403) return messages.upgrade;
  if (/Invalid .apkg/i.test(serverMessage)) return messages.corrupted;
  return serverMessage;
}

export default function PrintForm() {
  const { t } = useTranslation('tools');
  const messages: PrintMessages = {
    wrongType: t('print.wrongType'),
    corrupted: t('print.corrupted'),
    genericError: t('print.genericError'),
    auth: t('print.authMessage'),
    upgrade: t('print.upgradeMessage'),
  };

  const [state, setState] = useState<PrintState>('idle');
  const [cardCount, setCardCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [margins, setMargins] = useState<Margins>('normal');

  const resetForm = () => {
    setState('idle');
    setCardCount(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFile = async (file: File) => {
    if (!isApkgFile(file.name)) {
      setState('error');
      setErrorMessage(messages.wrongType);
      return;
    }

    setState('uploading');
    setErrorMessage(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('backgroundColor', backgroundColor);
    formData.append('paperSize', paperSize);
    formData.append('orientation', orientation);
    formData.append('margins', margins);

    try {
      const response = await globalThis.fetch('/api/apkg/pdf', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = globalThis.URL.createObjectURL(blob);
        const link = document.createElement('a');
        const name = file.name.replace(/\.apkg$/i, '.pdf');
        link.href = url;
        link.download = name;
        link.click();
        globalThis.URL.revokeObjectURL(url);

        setState('done');
        setCardCount(null);
      } else {
        const raw = await extractErrorMessage(response, messages.genericError);
        setState('error');
        setErrorMessage(toUserMessage(raw, response.status, messages));
      }
    } catch {
      setState('error');
      setErrorMessage(messages.genericError);
    }
  };

  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    const files = fileInputRef.current?.files;
    if (files == null || files.length === 0) return;
    await handleFile(files[0]);
  };

  const { dropHover, dragProps } = useDropZone<HTMLLabelElement>({
    onDrop: (event) => {
      const { dataTransfer } = event;
      if (dataTransfer && dataTransfer.files.length > 0) {
        handleFile(dataTransfer.files[0]);
      }
    },
  });

  const isUploading = state === 'uploading';

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.optionsGrid}>
        <div>
          <label htmlFor="print-paper-size" className={sharedStyles.fieldLabel}>
            {t('print.paperSize')}
          </label>
          <select
            id="print-paper-size"
            className={sharedStyles.select}
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as PaperSize)}
          >
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
            <option value="Legal">Legal</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="print-orientation"
            className={sharedStyles.fieldLabel}
          >
            {t('print.orientation')}
          </label>
          <select
            id="print-orientation"
            className={sharedStyles.select}
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as Orientation)}
          >
            <option value="portrait">{t('print.portrait')}</option>
            <option value="landscape">{t('print.landscape')}</option>
          </select>
        </div>
        <div>
          <label htmlFor="print-margins" className={sharedStyles.fieldLabel}>
            {t('print.margins')}
          </label>
          <select
            id="print-margins"
            className={sharedStyles.select}
            value={margins}
            onChange={(e) => setMargins(e.target.value as Margins)}
          >
            <option value="narrow">{t('print.marginNarrow')}</option>
            <option value="normal">{t('print.marginNormal')}</option>
            <option value="wide">{t('print.marginWide')}</option>
          </select>
        </div>
        <div>
          <label htmlFor="print-bg-color" className={sharedStyles.fieldLabel}>
            {t('print.pageBackground')}
          </label>
          <div className={styles.colorField}>
            <input
              id="print-bg-color"
              type="color"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              className={styles.colorInput}
            />
            <span className={styles.colorHex}>
              {backgroundColor.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      <label
        htmlFor="print-file"
        className={`${styles.dropZone} ${dropHover ? styles.dropZoneActive : ''}`}
        {...dragProps}
      >
        <span className={styles.dropLabel}>{t('print.dropLabel')}</span>
        <span className={styles.dropHint}>{t('print.or')}</span>
        <span className={styles.chooseButton}>
          {isUploading ? t('print.makingPdf') : t('print.selectFile')}
        </span>
        <input
          ref={fileInputRef}
          className={styles.fileInput}
          id="print-file"
          type="file"
          accept=".apkg"
          disabled={isUploading}
          onChange={() => submitRef.current?.click()}
        />
      </label>

      {isUploading && (
        <div
          className={sharedStyles.notificationInfo}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginTop: '1rem',
          }}
        >
          <div className={sharedStyles.spinnerSmall} />
          <span>{t('print.makingPdfHint')}</span>
        </div>
      )}

      {state === 'done' && (
        <p className={sharedStyles.notificationSuccess}>
          {t('print.doneMessage')}
          {cardCount == null
            ? ''
            : ` — ${t('print.doneCards', { count: cardCount })}`}
        </p>
      )}

      {state === 'error' && errorMessage && (
        <p className={sharedStyles.notificationDanger}>
          {errorMessage}
          {errorMessage === messages.wrongType && (
            <>
              {' '}
              <Link to="/upload">{t('print.goToUpload')}</Link>
            </>
          )}
          {errorMessage === messages.upgrade && (
            <>
              {' '}
              <Link to="/pricing">{t('print.viewPlans')}</Link>
            </>
          )}
          {errorMessage === messages.auth && (
            <>
              {' '}
              <Link to="/login">{t('print.logIn')}</Link>
            </>
          )}
          {CARD_LIMIT_PATTERN.test(errorMessage) && (
            <>
              {' '}
              <Link to="/pricing">{t('print.upgradeUnlimited')}</Link>
            </>
          )}
        </p>
      )}

      {state === 'done' && (
        <div className={styles.doneActions}>
          <button
            type="button"
            className={sharedStyles.btnSecondary}
            onClick={resetForm}
          >
            {t('print.printAnother')}
          </button>
        </div>
      )}

      <button ref={submitRef} type="submit" className={sharedStyles.hidden} />
    </form>
  );
}

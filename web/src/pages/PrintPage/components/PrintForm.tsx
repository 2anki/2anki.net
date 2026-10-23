import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import styles from './PrintForm.module.css';
import sharedStyles from '../../../styles/shared.module.css';
import { useDropZone } from '../../../lib/hooks/useDropZone';
import { useUserLocals } from '../../../lib/hooks/useUserLocals';
import { isPayingUser } from '../../../components/NavigationBar/helpers/getPlanLabel';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import { track } from '../../../lib/analytics/track';
import PrintPreview, { PrintPreviewState } from './PrintPreview';
import DeckChoice from '../../../components/DeckUpload/DeckChoice';
import NotADeckHandoff from '../../../components/DeckUpload/NotADeckHandoff';
import {
  deckLabel,
  isDeckUploadName,
  readDeckUploadAnswer,
  readHandoffFile,
  stripDeckExtension,
} from '../../../lib/deckUpload/deckUploadAnswer';

type PrintState =
  | 'idle'
  | 'previewing'
  | 'preview'
  | 'empty'
  | 'error'
  | 'done'
  | 'choose'
  | 'notADeck';
type PaperSize = 'A4' | 'Letter' | 'Legal';
type Orientation = 'portrait' | 'landscape';
type Margins = 'narrow' | 'normal' | 'wide';

interface PrintOptions {
  backgroundColor: string;
  paperSize: PaperSize;
  orientation: Orientation;
  margins: Margins;
}

interface PrintMessages {
  wrongType: string;
  corrupted: string;
  genericError: string;
  auth: string;
  upgrade: string;
}

interface DownloadError {
  status: number;
  message: string;
}

const CARD_LIMIT_PATTERN = /PDF export supports up to/i;

function optionsKey(options: PrintOptions): string {
  return `${options.backgroundColor}|${options.paperSize}|${options.orientation}|${options.margins}`;
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

function toPreviewErrorMessage(
  serverMessage: string,
  status: number,
  messages: PrintMessages
): string {
  if (status === 401) return messages.auth;
  if (/Invalid .apkg/i.test(serverMessage)) return messages.corrupted;
  return messages.genericError;
}

function toPreviewState(state: PrintState): PrintPreviewState {
  if (state === 'previewing') return 'rendering';
  if (state === 'empty') return 'empty';
  if (state === 'error') return 'error';
  return 'ready';
}

interface PreviewResponse {
  image: string | null;
  totalCards: number;
  previewedCards: number;
}

export default function PrintForm() {
  const { t } = useTranslation(['tools', 'accountx']);
  const messages: PrintMessages = {
    wrongType: t('print.wrongType'),
    corrupted: t('print.corrupted'),
    genericError: t('print.genericError'),
    auth: t('print.authMessage'),
    upgrade: t('print.upgradeMessage'),
  };

  const { data } = useUserLocals();
  const paying = isPayingUser(data?.locals);
  const freePrintAvailable = data?.freePrintAvailable ?? null;

  const [state, setState] = useState<PrintState>('idle');
  const [pickError, setPickError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<DownloadError | null>(
    null
  );
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [totalCards, setTotalCards] = useState(0);
  const [previewedCards, setPreviewedCards] = useState(0);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [freePrintUsedOverride, setFreePrintUsedOverride] = useState(false);
  const selectedFileRef = useRef<File | null>(null);
  const chosenEntryRef = useRef<string | null>(null);
  const [deckChoices, setDeckChoices] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [margins, setMargins] = useState<Margins>('normal');

  const currentOptions: PrintOptions = {
    backgroundColor,
    paperSize,
    orientation,
    margins,
  };

  const buildFormData = (file: File): FormData => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('backgroundColor', backgroundColor);
    formData.append('paperSize', paperSize);
    formData.append('orientation', orientation);
    formData.append('margins', margins);
    if (chosenEntryRef.current != null) {
      formData.append('deck_entry', chosenEntryRef.current);
    }
    return formData;
  };

  const resetForm = () => {
    setState('idle');
    setPickError(null);
    setPreviewError(null);
    setDownloadError(null);
    setPreviewImage(null);
    setTotalCards(0);
    setPreviewedCards(0);
    setPreviewedKey(null);
    setFreePrintUsedOverride(false);
    setDeckChoices([]);
    selectedFileRef.current = null;
    chosenEntryRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // A zip with several decks asks which one; a zip of notes goes to the
  // converter. Both are answers, not errors.
  const answerDeckUpload = async (response: Response): Promise<boolean> => {
    const answer = await readDeckUploadAnswer(response);
    if (answer == null) return false;
    if (answer.kind === 'choose_deck') {
      setDeckChoices(answer.decks);
      setState('choose');
    } else {
      setState('notADeck');
    }
    return true;
  };

  const runPreview = async (file: File) => {
    const keyAtRequest = optionsKey(currentOptions);
    setState('previewing');
    setPreviewError(null);
    setDownloadError(null);

    try {
      const response = await globalThis.fetch('/api/apkg/pdf/preview', {
        method: 'POST',
        body: buildFormData(file),
      });
      if (response.ok) {
        const body = (await response.json()) as PreviewResponse;
        if (body.image == null || body.totalCards === 0) {
          setState('empty');
          return;
        }
        setPreviewImage(body.image);
        setTotalCards(body.totalCards);
        setPreviewedCards(body.previewedCards);
        setPreviewedKey(keyAtRequest);
        setState('preview');
        track('print_preview_shown', {
          totalCards: body.totalCards,
          previewedCards: body.previewedCards,
          freePrintAvailable: paying || freePrintAvailable !== false,
        });
      } else if (!(await answerDeckUpload(response))) {
        const raw = await extractErrorMessage(response, messages.genericError);
        setPreviewError(toPreviewErrorMessage(raw, response.status, messages));
        setState('error');
      }
    } catch {
      setPreviewError(messages.genericError);
      setState('error');
    }
  };

  const handleFile = async (file: File) => {
    if (!isDeckUploadName(file.name)) {
      setPickError(messages.wrongType);
      setState('idle');
      return;
    }
    setPickError(null);
    selectedFileRef.current = file;
    chosenEntryRef.current = null;
    await runPreview(file);
  };

  const handleDeckChosen = async (entry: string) => {
    const file = selectedFileRef.current;
    if (file == null) return;
    chosenEntryRef.current = entry;
    await runPreview(file);
  };

  const location = useLocation();
  const navigate = useNavigate();
  const handoffTakenRef = useRef(false);
  useEffect(() => {
    if (handoffTakenRef.current) return;
    const handedOff = readHandoffFile(location.state);
    if (handedOff == null) return;
    handoffTakenRef.current = true;
    // Back, Forward or a reload must not hand the same file over again.
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: null,
    });
    void handleFile(handedOff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleUpdatePreview = async () => {
    const file = selectedFileRef.current;
    if (file == null) return;
    await runPreview(file);
  };

  const downloadFullPdf = async () => {
    const file = selectedFileRef.current;
    if (file == null) return;
    setDownloadBusy(true);
    setDownloadError(null);
    try {
      const response = await globalThis.fetch('/api/apkg/pdf', {
        method: 'POST',
        body: buildFormData(file),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = globalThis.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const pdfName =
          chosenEntryRef.current == null
            ? stripDeckExtension(file.name)
            : deckLabel(chosenEntryRef.current);
        link.download = `${pdfName}.pdf`;
        link.click();
        globalThis.URL.revokeObjectURL(url);
        setState('done');
      } else if (response.status === 402) {
        setFreePrintUsedOverride(true);
      } else if (await answerDeckUpload(response)) {
        return;
      } else {
        const raw = await extractErrorMessage(response, messages.genericError);
        setDownloadError({
          status: response.status,
          message: toUserMessage(raw, response.status, messages),
        });
      }
    } catch {
      setDownloadError({ status: 0, message: messages.genericError });
    } finally {
      setDownloadBusy(false);
    }
  };

  const handlePass = async () => {
    setPassBusy(true);
    try {
      const result = await get2ankiApi().startPassCheckout(
        '24h',
        undefined,
        'print'
      );
      if ('url' in result) {
        globalThis.location.href = result.url;
        return;
      }
      setDownloadError({
        status: 0,
        message: t('limit.checkoutError', { ns: 'accountx' }),
      });
    } finally {
      setPassBusy(false);
    }
  };

  const { dropHover, dragProps } = useDropZone<HTMLLabelElement>({
    onDrop: (event) => {
      const { dataTransfer } = event;
      if (dataTransfer && dataTransfer.files.length > 0) {
        handleFile(dataTransfer.files[0]);
      }
    },
  });

  const previewState = toPreviewState(state);
  const optionsChanged =
    state === 'preview' && previewedKey !== optionsKey(currentOptions);
  const effectiveFreePrintAvailable = freePrintUsedOverride
    ? false
    : freePrintAvailable;

  const downloadErrorNode: ReactNode = downloadError && (
    <p className={sharedStyles.notificationDanger}>
      {downloadError.message}
      {CARD_LIMIT_PATTERN.test(downloadError.message) && (
        <>
          {' '}
          <Link to="/pricing">{t('print.upgradeUnlimited')}</Link>
        </>
      )}
      {downloadError.status === 401 && (
        <>
          {' '}
          <Link to="/login">{t('print.logIn')}</Link>
        </>
      )}
      {downloadError.status === 403 && (
        <>
          {' '}
          <Link to="/pricing">{t('print.viewPlans')}</Link>
        </>
      )}
    </p>
  );

  return (
    <form onSubmit={(event) => event.preventDefault()}>
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

      {state === 'idle' && (
        <>
          <label
            htmlFor="print-file"
            className={`${styles.dropZone} ${dropHover ? styles.dropZoneActive : ''}`}
            {...dragProps}
          >
            <span className={styles.dropLabel}>{t('print.dropLabel')}</span>
            <span className={styles.dropHint}>{t('print.or')}</span>
            <span className={styles.chooseButton}>{t('print.selectFile')}</span>
            <input
              ref={fileInputRef}
              className={styles.fileInput}
              id="print-file"
              type="file"
              accept=".apkg,.zip"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
          {pickError != null && (
            <p className={sharedStyles.notificationDanger}>
              {pickError}
              {pickError === messages.wrongType && (
                <>
                  {' '}
                  <Link to="/upload">{t('print.goToUpload')}</Link>
                </>
              )}
            </p>
          )}
        </>
      )}

      {state === 'done' && (
        <>
          <p className={sharedStyles.notificationSuccess}>
            {t('print.doneMessage')}
          </p>
          <div className={styles.doneActions}>
            <button
              type="button"
              className={sharedStyles.btnSecondary}
              onClick={resetForm}
            >
              {t('print.printAnother')}
            </button>
          </div>
        </>
      )}

      {state === 'choose' && (
        <DeckChoice
          decks={deckChoices}
          actionLabel={t('deckUpload.printThis')}
          onChoose={(entry) => void handleDeckChosen(entry)}
          onCancel={resetForm}
        />
      )}

      {state === 'notADeck' && selectedFileRef.current != null && (
        <NotADeckHandoff file={selectedFileRef.current} onCancel={resetForm} />
      )}

      {state !== 'idle' &&
        state !== 'done' &&
        state !== 'choose' &&
        state !== 'notADeck' && (
          <PrintPreview
            state={previewState}
            imageSrc={previewImage}
            totalCards={totalCards}
            previewedCards={previewedCards}
            paying={paying}
            freePrintAvailable={effectiveFreePrintAvailable}
            optionsChanged={optionsChanged}
            downloadBusy={downloadBusy}
            passBusy={passBusy}
            errorMessage={previewError}
            downloadError={downloadErrorNode}
            onUpdatePreview={handleUpdatePreview}
            onDownload={downloadFullPdf}
            onPass={handlePass}
            onPreviewAnother={resetForm}
          />
        )}
    </form>
  );
}

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { purchaseConflictMessage } from '../../../lib/checkout/purchaseConflictMessage';
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
  DECK_UPLOAD_ACCEPT,
  isDeckUploadName,
  readDeckUploadAnswer,
  readHandoffFile,
  stripDeckExtension,
} from '../../../lib/deckUpload/deckUploadAnswer';
import { APKG_TOOL_MAX_BYTES } from '../../../lib/upload/uploadSizeLimits';

type PrintState =
  | 'idle'
  | 'previewing'
  | 'preview'
  | 'empty'
  | 'error'
  | 'done'
  | 'choose'
  | 'notADeck'
  | 'waitingForSession'
  | 'signIn';
type Session = 'loading' | 'signedIn' | 'signedOut' | 'unreadable';
type SignInReason = 'signed_out' | 'session_ended';
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
  upgrade: string;
  tooLarge: string;
  tooManyPreviews: string;
  networkError: string;
  serverError: string;
}

interface DownloadError {
  status: number;
  message: string;
}

interface PreviewError {
  message: string;
  retry: boolean;
}

const CARD_LIMIT_PATTERN = /PDF export supports up to/i;
const INVALID_DECK_PATTERN = /Invalid .apkg/i;
const SIGN_IN_RETURN = '/print';

function optionsKey(options: PrintOptions): string {
  return `${options.backgroundColor}|${options.paperSize}|${options.orientation}|${options.margins}`;
}

function sessionOf(
  userId: number | null | undefined,
  loaded: boolean,
  failed: boolean
): Session {
  if (userId != null) return 'signedIn';
  if (loaded) return 'signedOut';
  return failed ? 'unreadable' : 'loading';
}

async function readServerMessage(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().json();
    if (typeof body?.message === 'string' && body.message.trim().length > 0) {
      return body.message;
    }
  } catch {
    /* response not JSON */
  }
  return null;
}

function toUserMessage(
  serverMessage: string,
  status: number,
  messages: PrintMessages
): string {
  if (status === 403) return messages.upgrade;
  if (INVALID_DECK_PATTERN.test(serverMessage)) return messages.corrupted;
  return serverMessage;
}

function toPreviewError(
  status: number,
  serverMessage: string | null,
  messages: PrintMessages
): PreviewError {
  if (status === 413) return { message: messages.tooLarge, retry: false };
  if (status === 429 || status === 503) {
    return { message: messages.tooManyPreviews, retry: true };
  }
  if (status === 408 || (status === 400 && serverMessage == null)) {
    return { message: messages.networkError, retry: true };
  }
  if (status >= 500) return { message: messages.serverError, retry: true };
  if (serverMessage != null && INVALID_DECK_PATTERN.test(serverMessage)) {
    return { message: messages.corrupted, retry: false };
  }
  return { message: messages.genericError, retry: true };
}

function toPreviewState(state: PrintState): PrintPreviewState {
  if (state === 'previewing' || state === 'waitingForSession') {
    return 'rendering';
  }
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
  const { t, i18n } = useTranslation(['tools', 'accountx']);
  const messages: PrintMessages = {
    wrongType: t('print.wrongType'),
    corrupted: t('print.corrupted'),
    genericError: t('print.genericError'),
    upgrade: t('print.upgradeMessage'),
    tooLarge: t('print.tooLarge'),
    tooManyPreviews: t('print.tooManyPreviews'),
    networkError: t('print.networkError'),
    serverError: t('print.serverError'),
  };

  const {
    data,
    isError: localsFailed,
    refetch: refetchLocals,
  } = useUserLocals();
  const paying = isPayingUser(data?.locals);
  const freePrintAvailable = data?.freePrintAvailable ?? null;
  const session = sessionOf(data?.user?.id, data != null, localsFailed);

  const [state, setState] = useState<PrintState>('idle');
  const [pickError, setPickError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<PreviewError | null>(null);
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
  const signInHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusDropZoneRef = useRef(false);
  const previewOnSignInRef = useRef(false);

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
    previewOnSignInRef.current = false;
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

  const askToSignIn = (reason: SignInReason) => {
    previewOnSignInRef.current = reason === 'signed_out';
    setState('signIn');
    track('print_sign_in_shown', { reason });
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
      } else if (response.status === 401) {
        askToSignIn('session_ended');
      } else if (!(await answerDeckUpload(response))) {
        setPreviewError(
          toPreviewError(
            response.status,
            await readServerMessage(response),
            messages
          )
        );
        setState('error');
      }
    } catch {
      setPreviewError({ message: messages.networkError, retry: true });
      setState('error');
    }
  };

  const previewWhenSignedIn = async (file: File) => {
    if (session === 'loading') {
      setState('waitingForSession');
    } else if (session === 'signedOut') {
      askToSignIn('signed_out');
    } else {
      await runPreview(file);
    }
  };

  useEffect(() => {
    const file = selectedFileRef.current;
    if (file == null) return;
    if (state === 'waitingForSession' && session !== 'loading') {
      void previewWhenSignedIn(file);
    } else if (state === 'signIn' && session === 'signedOut') {
      previewOnSignInRef.current = true;
    } else if (
      state === 'signIn' &&
      session === 'signedIn' &&
      previewOnSignInRef.current
    ) {
      previewOnSignInRef.current = false;
      void runPreview(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, state]);

  useEffect(() => {
    if (state === 'signIn') {
      signInHeadingRef.current?.focus();
    } else if (state === 'idle' && focusDropZoneRef.current) {
      focusDropZoneRef.current = false;
      fileInputRef.current?.focus();
    }
  }, [state]);

  const cancelSignIn = () => {
    resetForm();
    focusDropZoneRef.current = true;
  };

  const handleFile = async (file: File) => {
    if (!isDeckUploadName(file.name)) {
      setPickError(messages.wrongType);
      setState('idle');
      return;
    }
    if (file.size > APKG_TOOL_MAX_BYTES) {
      setPickError(messages.tooLarge);
      setState('idle');
      return;
    }
    setPickError(null);
    selectedFileRef.current = file;
    chosenEntryRef.current = null;
    await previewWhenSignedIn(file);
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
      } else if (response.status === 401) {
        askToSignIn('session_ended');
      } else if (response.status === 402) {
        setFreePrintUsedOverride(true);
        void refetchLocals();
        setDownloadError({ status: 402, message: messages.upgrade });
      } else if (await answerDeckUpload(response)) {
        return;
      } else {
        const raw =
          (await readServerMessage(response)) ?? messages.genericError;
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
        message:
          result.status === 'conflict'
            ? purchaseConflictMessage(t, result, i18n.language)
            : t('limit.checkoutError', { ns: 'accountx' }),
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
              accept={DECK_UPLOAD_ACCEPT}
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

      {state === 'signIn' && (
        <section
          className={styles.previewPanel}
          aria-labelledby="print-sign-in-title"
        >
          <h2
            id="print-sign-in-title"
            ref={signInHeadingRef}
            tabIndex={-1}
            className={styles.signInTitle}
          >
            {t('print.signInTitle')}
          </h2>
          {selectedFileRef.current != null && (
            <p className={styles.signInFile} data-hj-suppress>
              {selectedFileRef.current.name}
            </p>
          )}
          <p className={styles.previewLede}>{t('print.signInBody')}</p>
          <div className={styles.previewActions}>
            <a
              href={`/register?redirect=${SIGN_IN_RETURN}`}
              className={`${sharedStyles.btnPrimary} ${styles.signInAction}`}
            >
              {t('limit.signUpFree', { ns: 'accountx' })}
            </a>
            <a
              href={`/login?redirect=${SIGN_IN_RETURN}`}
              className={`${sharedStyles.btnSecondary} ${styles.signInAction}`}
            >
              {t('print.logIn')}
            </a>
            <button
              type="button"
              className={styles.previewAnotherLink}
              onClick={cancelSignIn}
            >
              {t('print.cancel')}
            </button>
          </div>
        </section>
      )}

      {state !== 'idle' &&
        state !== 'done' &&
        state !== 'choose' &&
        state !== 'notADeck' &&
        state !== 'signIn' && (
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
            errorMessage={previewError?.message ?? null}
            downloadError={downloadErrorNode}
            onRetry={previewError?.retry ? handleUpdatePreview : undefined}
            onUpdatePreview={handleUpdatePreview}
            onDownload={downloadFullPdf}
            onPass={handlePass}
            onPreviewAnother={resetForm}
          />
        )}
    </form>
  );
}

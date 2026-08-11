import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  classifyUploadError,
  ErrorHandlerType,
} from '../../../../components/errors/helpers/getErrorMessage';
import handleRedirect from '../../../../lib/handleRedirect';
import { getStoredPassToken } from '../../../../lib/anonymousPass';
import type { UploadErrorBody } from '../../../../types/UploadErrorBody';
import getAcceptedContentTypes from '../../helpers/getAcceptedContentTypes';
import { extractErrorMessage } from '../../helpers/extractErrorMessage';
import {
  applyConversionSuccess,
  type ConversionSuccessHandlers,
} from './uploadResponse';
import { getDownloadFileName } from '../../../DownloadsPage/helpers/getDownloadFileName';
import { ImageDropNotice } from '../../../DownloadsPage/components/ImageDropNotice';
import { EmptyBackNotice } from '../../../DownloadsPage/components/EmptyBackNotice';
import { StructureRescuedNotice } from '../../../DownloadsPage/components/StructureRescuedNotice';
import { ConversionResult } from '../../../DownloadsPage/components/ConversionResult/ConversionResult';
import { OverSplitNotice } from './OverSplitNotice';
import { getEmptyDeckChatPrompt } from '../../helpers/getEmptyDeckChatPrompt';
import { useDrag } from './hooks/useDrag';
import { useUploadFormState } from './hooks/useUploadFormState';
import { useFileValidation } from './hooks/useFileValidation';
import { useDropboxChooser, type DropboxFile } from './hooks/useDropboxChooser';
import { useGooglePicker, type GoogleDriveFile } from './hooks/useGooglePicker';
import { UploadSourceChips, type UploadSource } from './UploadSourceChips';
import { getStaleSourceState } from './helpers/getStaleSourceState';
import { FeedbackWidget } from '../../../../components/FeedbackWidget/FeedbackWidget';
import { useUserLocals } from '../../../../lib/hooks/useUserLocals';
import {
  useCardUsage,
  CARD_USAGE_QUERY_KEY,
} from '../../../../lib/hooks/useCardUsage';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import { fireAnalyticsEvent } from '../../../../lib/analytics/fireAnalyticsEvent';
import { track } from '../../../../lib/analytics/track';
import ChatPanel from '../../../../components/ChatPanel/ChatPanel';
import { UpsellCard } from '../../../../components/UpsellCard';
import { CreateAccountNotice } from '../../../../components/CreateAccountNotice/CreateAccountNotice';
import { isPayingUser } from '../../../../components/NavigationBar/helpers/getPlanLabel';
import { resolveSuccessOffer } from '../../../../lib/promo/resolveSuccessOffer';
import formStyles from './UploadForm.module.css';
import sharedStyles from '../../../../styles/shared.module.css';
import {
  collectDroppedEntries,
  hasDirectoryEntry,
  FolderEmptyError,
  FolderTooBigError,
} from './helpers/collectDroppedEntries';
import { zipDroppedFiles } from './helpers/zipDroppedEntries';

import type {
  ZoneState,
  LockedPdfInfo,
  LimitInfo,
} from './hooks/useUploadFormState';

interface UploadFormProps {
  setErrorMessage: ErrorHandlerType;
  aiOn?: boolean;
}

const FORMATS = [
  '.zip',
  '.html',
  '.md',
  '.pdf',
  '.epub',
  'My Clippings.txt',
  '.docx',
  '.xlsx',
  '.pptx',
  '.csv',
  '.opml',
  '.brainstorms.json',
];

const REJECTED_FALLBACK =
  'The server rejected the upload. Try again or email support@2anki.net.';
const NETWORK_FALLBACK =
  "Couldn't upload your file. Check your connection and try again.";

function isLimitRedirect(url: URL): boolean {
  return (
    url.pathname === '/limit' ||
    url.searchParams.get('error') === 'upload_limit_exceeded'
  );
}

function isAnonymousLimit(url: URL): boolean {
  return url.searchParams.get('kind') === 'anonymous';
}

function getLimitKind(url: URL): 'file_size' | 'card_count' {
  return url.searchParams.get('kind') === 'card_count'
    ? 'card_count'
    : 'file_size';
}

function getLimitDescription(
  kind: 'file_size' | 'card_count',
  context: 'anonymous' | 'logged_in'
): string {
  if (kind === 'file_size') {
    if (context === 'anonymous')
      return 'Create a free account to convert files of any size, or split the file and try again.';
    return 'Split the file, or upgrade to convert files of any size.';
  }
  if (context === 'anonymous')
    return 'Create a free account to start converting, or upgrade for no monthly cap.';
  return 'Upgrade for no monthly cap, or wait until next month.';
}

function decodeFilename(filename: string | null): string | null {
  if (filename == null) return filename;
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toFriendlyThrownError(error: unknown): UploadErrorBody {
  const isNetworkError =
    error instanceof TypeError ||
    (error instanceof Error && /fetch|network/i.test(error.message));
  if (isNetworkError) return { code: 'unknown', message: NETWORK_FALLBACK };
  if (error instanceof Error)
    return { code: 'unknown', message: error.message };
  return { code: 'unknown', message: REJECTED_FALLBACK };
}

function zoneStateForUploadError(
  message: UploadErrorBody
): 'emptyDeck' | 'imageOnly' | 'error' {
  if (message.code === 'image_only_no_text') {
    return 'imageOnly';
  }
  if (
    message.code === 'empty_export' ||
    message.code === 'markdown_likely_lossy'
  ) {
    return 'emptyDeck';
  }
  return 'error';
}

function buildFormData(form: HTMLFormElement): FormData {
  const formData = new FormData(form);
  for (const [key, value] of Object.entries(globalThis.localStorage)) {
    formData.append(key, value);
  }
  return formData;
}

function displayFilename(fileInput: HTMLInputElement | null): string {
  const files = fileInput?.files;
  if (!files || files.length === 0) return '';
  if (files.length === 1) return files[0].name;
  return `${files.length} files`;
}

function UploadCloudIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 32L24 24L32 32" />
      <path d="M24 24V42" />
      <path d="M40.78 35.61A8 8 0 0038 20H35.28A12.8 12.8 0 1010 28.67" />
      <path d="M16 32L24 24L32 32" />
    </svg>
  );
}

function CheckCircleIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="20" />
      <path d="M16 24L22 30L34 18" />
    </svg>
  );
}

function DropboxIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 4l8 5-8 5-8-5 8-5zm16 0l8 5-8 5-8-5 8-5zM0 19l8-5 8 5-8 5-8-5zm24-5l8 5-8 5-8-5 8-5zM8 26l8-5 8 5-8 5-8-5z" />
    </svg>
  );
}

function GoogleDriveIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11 4h10l10 17.5h-10L11 4zm-1 1.7L0 23.2 5 32h10L5 14.5 10 5.7zM10.5 23.5h21L26.5 32H5.5l5-8.5z" />
    </svg>
  );
}

function WarningIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.07 6.73L3.51 38a3.2 3.2 0 002.93 4.8h35.12a3.2 3.2 0 002.93-4.8L26.93 6.73a3.2 3.2 0 00-5.86 0z" />
      <line x1="24" y1="18" x2="24" y2="28" />
      <circle cx="24" cy="34" r="0.5" fill="currentColor" />
    </svg>
  );
}

function UploadForm({
  setErrorMessage,
  aiOn = false,
}: Readonly<UploadFormProps>) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const convertRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const {
    validation,
    validate,
    reset: resetValidation,
  } = useFileValidation(aiOn);

  const {
    zoneState,
    setZoneState,
    batchResult,
    setBatchResult,
    downloadLink,
    setDownloadLink,
    deckName,
    setDeckName,
    cardCount,
    setCardCount,
    mcqCount,
    setMcqCount,
    mcqSkippedCount,
    setMcqSkippedCount,
    droppedImageCount,
    overSplit,
    setDroppedImageCount,
    expiredNotionImageCount,
    setExpiredNotionImageCount,
    emptyBackCount,
    setEmptyBackCount,
    setOverSplit,
    structureRescuedRule,
    setStructureRescuedRule,
    mcqDrawerOpen,
    setMcqDrawerOpen,
    mcqShowAnswer,
    setMcqShowAnswer,
    warningMessage,
    setWarningMessage,
    limitInfo,
    setLimitInfo,
    localError,
    setLocalError,
    progressWidth,
    setProgressWidth,
    progressSlow,
    setProgressSlow,
    showFallback,
    setShowFallback,
    dropboxFilename,
    setDropboxFilename,
    dropboxPending,
    setDropboxPending,
    dropboxError,
    setDropboxError,
    driveFilename,
    setDriveFilename,
    driveMimeType,
    setDriveMimeType,
    drivePending,
    setDrivePending,
    driveError,
    setDriveError,
    source,
    setSource,
    showInlineChat,
    setShowInlineChat,
    showErrorInlineChat,
    setShowErrorInlineChat,
    lockedPdfInfo,
    setLockedPdfInfo,
    pdfCredential,
    setPdfCredential,
    pdfUnlockError,
    setPdfUnlockError,
    pdfAttemptCount,
    setPdfAttemptCount,
    resetForm,
  } = useUploadFormState(() => {
    resetValidation();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
    }
  });

  const handleSourceChange = (next: UploadSource) => {
    const { clearDrive, clearDropbox } = getStaleSourceState(next);
    if (clearDrive) {
      setDriveFilename(null);
      setDriveMimeType(null);
      setDriveError(null);
    }
    if (clearDropbox) {
      setDropboxFilename(null);
      setDropboxError(null);
    }
    setSource(next);
  };

  const conversionSuccessHandlers: ConversionSuccessHandlers = {
    setWarningMessage,
    setDeckName,
    setCardCount,
    setMcqCount,
    setMcqSkippedCount,
    setDroppedImageCount,
    setExpiredNotionImageCount,
    setEmptyBackCount,
    setOverSplit,
    setDownloadLink,
    setProgressWidth,
    setBatchResult,
    setZoneState,
    setStructureRescuedRule,
  };

  const { data: userLocals } = useUserLocals();
  const queryClient = useQueryClient();
  const isAuthenticated = userLocals?.user?.id != null;
  const [dayPassPending, setDayPassPending] = useState(false);
  const [dayPassError, setDayPassError] = useState<string | null>(null);
  const showSignInPrompt = userLocals != null && !isAuthenticated;
  const cardUsage = useCardUsage(isAuthenticated);
  const isUploadLocked =
    isAuthenticated &&
    userLocals?.user?.patreon !== true &&
    cardUsage != null &&
    !cardUsage.unlimited &&
    !cardUsage.loading &&
    cardUsage.cards_used >= cardUsage.cards_limit;
  const { openChooser, isConfigured: isDropboxConfigured } =
    useDropboxChooser(FORMATS);
  const { openPicker, isConfigured: isGoogleDriveConfigured } =
    useGooglePicker();
  const driveButtonRef = useRef<HTMLButtonElement>(null);

  const handleDayPass = async () => {
    setDayPassError(null);
    setDayPassPending(true);
    track('paywall_upgrade_clicked', {
      surface: 'upload_limit_wall',
      plan: 'day_pass',
    });
    try {
      const result = await get2ankiApi().startPassCheckout(
        '24h',
        undefined,
        'upload-limit-wall'
      );
      if ('url' in result) {
        globalThis.location.href = result.url;
        return;
      }
      setDayPassError(
        "Couldn't start checkout. Try again, or email support@2anki.net."
      );
    } catch {
      setDayPassError(
        "Couldn't start checkout. Check your connection and try again."
      );
    } finally {
      setDayPassPending(false);
    }
  };

  const submitFiles = () => {
    convertRef.current?.click();
  };

  useEffect(() => {
    if (isUploadLocked) {
      track('paywall_shown', {
        surface: 'upload_limit_wall',
        variant: 'preemptive',
      });
    }
  }, [isUploadLocked]);

  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState<
    'tooBig' | 'empty' | 'failed' | null
  >(null);

  const handleFolderDrop = async (
    entries: Array<FileSystemEntry | null>,
    droppedFolderName: string
  ) => {
    setFolderError(null);
    setFolderName(droppedFolderName);
    setZoneState('packaging');
    track('folder_upload_packaged');
    try {
      const droppedFiles = await collectDroppedEntries(entries);
      const zipFile = await zipDroppedFiles(droppedFolderName, droppedFiles);
      const transfer = new DataTransfer();
      transfer.items.add(zipFile);
      fileInputRef.current!.files = transfer.files;
      if (validate(transfer.files)) {
        submitFiles();
      } else {
        setZoneState('idle');
      }
    } catch (error) {
      if (error instanceof FolderTooBigError) {
        setFolderError('tooBig');
      } else if (error instanceof FolderEmptyError) {
        setFolderError('empty');
      } else {
        setFolderError('failed');
      }
      setZoneState('error');
    }
  };

  const { dropHover } = useDrag({
    onDrop: (event) => {
      if (isUploadLocked || zoneState === 'packaging') {
        event.preventDefault();
        return;
      }
      const { dataTransfer } = event;
      // webkitGetAsEntry must be read synchronously — DataTransferItemList
      // goes inert once the drop handler returns.
      const entries = dataTransfer
        ? Array.from(dataTransfer.items, (item) =>
            typeof item.webkitGetAsEntry === 'function'
              ? item.webkitGetAsEntry()
              : null
          )
        : [];
      if (hasDirectoryEntry(entries)) {
        const firstDirectory = entries.find((e) => e?.isDirectory === true);
        void handleFolderDrop(entries, firstDirectory?.name ?? 'upload');
        event.preventDefault();
        return;
      }
      if (dataTransfer && dataTransfer.files.length > 0) {
        fileInputRef.current!.files = dataTransfer.files;
        if (validate(dataTransfer.files)) {
          submitFiles();
        }
      }
      event.preventDefault();
    },
  });

  useEffect(() => {
    if (zoneState === 'converting') {
      setFolderError(null);
    }
  }, [zoneState]);

  useEffect(() => {
    if (zoneState === 'success' && downloadLink && !showFallback) {
      globalThis.sessionStorage?.removeItem('upload_pending_filename');
      queryClient.invalidateQueries({ queryKey: CARD_USAGE_QUERY_KEY });
      if (cardCount !== 0) {
        fireAnalyticsEvent('deck_downloaded');
        track('deck_downloaded');
        downloadRef.current?.click();
      }
      fallbackTimerRef.current = setTimeout(() => {
        setShowFallback(true);
      }, 3000);
    }
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
      }
    };
  }, [zoneState, downloadLink]);

  useEffect(() => {
    if (zoneState !== 'converting') return;
    setProgressWidth(70);
    const timer = setTimeout(() => {
      setProgressSlow(true);
      setProgressWidth(90);
    }, 2000);
    return () => clearTimeout(timer);
  }, [zoneState]);

  useEffect(() => {
    if (zoneState === 'error') {
      track('upload_error_chat_shown');
    }
  }, [zoneState]);

  useEffect(() => {
    if (zoneState === 'success' && showErrorInlineChat) {
      track('upload_error_chat_resolved_retry');
    }
  }, [zoneState, showErrorInlineChat]);

  useEffect(() => {
    if (zoneState === 'emptyDeck') {
      track('upload_empty_deck_chat_shown');
    }
  }, [zoneState]);

  useEffect(() => {
    if (zoneState === 'imageOnly') {
      track('image_only_photo_deck_shown');
    }
  }, [zoneState]);

  const uploadCancelledFiredRef = useRef(false);
  useEffect(() => {
    if (zoneState !== 'converting') return;
    const fireUploadCancelled = () => {
      if (uploadCancelledFiredRef.current) return;
      uploadCancelledFiredRef.current = true;
      track('upload_cancelled', { stage: 'converting' });
    };
    globalThis.addEventListener('pagehide', fireUploadCancelled);
    return () => {
      globalThis.removeEventListener('pagehide', fireUploadCancelled);
    };
  }, [zoneState]);

  const handleDropboxFiles = async (files: DropboxFile[]) => {
    const first = files[0];
    setDropboxFilename(first?.name ?? null);
    setDropboxError(null);
    setZoneState('converting');
    fireAnalyticsEvent('upload_started');
    setProgressWidth(10);
    setProgressSlow(false);
    setShowFallback(false);
    try {
      const formData = new FormData();
      formData.append('files', JSON.stringify(files));
      for (const [key, value] of Object.entries(globalThis.localStorage)) {
        formData.append(key, value);
      }
      const request = await globalThis.fetch('/api/upload/dropbox', {
        method: 'post',
        body: formData,
      });
      if (request.redirected) {
        const redirectUrl = new URL(request.url, globalThis.location.origin);
        if (isLimitRedirect(redirectUrl)) {
          if (isAnonymousLimit(redirectUrl)) {
            globalThis.location.href = '/limit?kind=anonymous';
            return;
          }
          const kind = getLimitKind(redirectUrl);
          setLimitInfo({
            filename: first?.name ?? null,
            fileSizeBytes: kind === 'file_size' ? (first?.bytes ?? null) : null,
            kind,
          });
          setZoneState('limitReached');
          return;
        }
        handleRedirect(request);
        return;
      }
      if (request.status === 202) {
        globalThis.location.href = '/downloads';
        return;
      }
      if (request.status !== 200) {
        const message = await extractErrorMessage(request);
        setLocalError(message);
        setZoneState(zoneStateForUploadError(message));
        return;
      }
      await applyConversionSuccess(request, conversionSuccessHandlers);
    } catch (error) {
      setLocalError(toFriendlyThrownError(error));
      setZoneState('error');
    }
  };

  const handleDropboxClick = async () => {
    setDropboxError(null);
    setDropboxPending(true);
    try {
      const outcome = await openChooser();
      if (outcome.kind === 'cancelled') return;
      if (outcome.files.length === 0) return;
      await handleDropboxFiles(outcome.files);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Couldn't open Dropbox. Try again in a moment.";
      setDropboxError(message);
    } finally {
      setDropboxPending(false);
    }
  };

  const handleGoogleDriveFiles = async (
    files: GoogleDriveFile[],
    accessToken: string
  ) => {
    const first = files[0];
    setDriveFilename(first?.name ?? null);
    setDriveMimeType(first?.mimeType ?? null);
    setDriveError(null);
    setZoneState('converting');
    fireAnalyticsEvent('upload_started');
    setProgressWidth(10);
    setProgressSlow(false);
    setShowFallback(false);
    try {
      const formData = new FormData();
      formData.append('files', JSON.stringify(files));
      formData.append('googleDriveAuth', accessToken);
      for (const [key, value] of Object.entries(globalThis.localStorage)) {
        formData.append(key, value);
      }
      const request = await globalThis.fetch('/api/upload/google_drive', {
        method: 'post',
        body: formData,
      });
      if (request.redirected) {
        const redirectUrl = new URL(request.url, globalThis.location.origin);
        if (isLimitRedirect(redirectUrl)) {
          if (isAnonymousLimit(redirectUrl)) {
            globalThis.location.href = '/limit?kind=anonymous';
            return;
          }
          const kind = getLimitKind(redirectUrl);
          setLimitInfo({
            filename: first?.name ?? null,
            fileSizeBytes:
              kind === 'file_size' ? (first?.sizeBytes ?? null) : null,
            kind,
          });
          setZoneState('limitReached');
          return;
        }
        handleRedirect(request);
        return;
      }
      if (request.status === 202) {
        globalThis.location.href = '/downloads';
        return;
      }
      if (request.status !== 200) {
        const message = await extractErrorMessage(request);
        setLocalError(message);
        setZoneState(zoneStateForUploadError(message));
        return;
      }
      await applyConversionSuccess(request, conversionSuccessHandlers);
    } catch (error) {
      setLocalError(toFriendlyThrownError(error));
      setZoneState('error');
    }
  };

  const handleGoogleDriveClick = async () => {
    setDriveError(null);
    setDrivePending(true);
    // The Google sign-in pop-up takes over the window; anchor the page at
    // the top first so returning from it (or the picker itself) doesn't
    // leave the user scrolled to wherever the browser's default focus
    // restoration happens to land.
    globalThis.scrollTo?.({ top: 0, behavior: 'auto' });
    try {
      const outcome = await openPicker();
      if (outcome.kind === 'cancelled') return;
      if (outcome.files.length === 0) return;
      await handleGoogleDriveFiles(outcome.files, outcome.accessToken);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Couldn't reach Google Drive. Sign in again and retry.";
      setDriveError(message);
    } finally {
      setDrivePending(false);
    }
  };

  const wasDrivePendingRef = useRef(false);
  useEffect(() => {
    // Runs after the DOM commit, once the button is re-enabled — focusing
    // it any earlier (e.g. right after setDrivePending(false)) would be a
    // no-op, since a disabled element can't take focus. preventScroll:
    // handleGoogleDriveClick already anchored the page at the top, so a
    // plain focus() here would just scroll it into view a second time.
    if (wasDrivePendingRef.current && !drivePending) {
      driveButtonRef.current?.focus({ preventScroll: true });
    }
    wasDrivePendingRef.current = drivePending;
  }, [drivePending]);

  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setZoneState('converting');
    fireAnalyticsEvent('upload_started');
    setProgressWidth(10);
    setProgressSlow(false);
    setShowFallback(false);
    try {
      const formData = buildFormData(event.currentTarget as HTMLFormElement);
      const passToken = getStoredPassToken();
      const uploadHeaders: HeadersInit =
        passToken == null ? {} : { 'X-Pass-Token': passToken };
      const request = await globalThis.fetch('/api/upload/file', {
        method: 'post',
        headers: uploadHeaders,
        body: formData,
      });
      if (request.redirected) {
        const redirectUrl = new URL(request.url, globalThis.location.origin);
        if (isLimitRedirect(redirectUrl)) {
          if (isAnonymousLimit(redirectUrl)) {
            globalThis.location.href = '/limit?kind=anonymous';
            return true;
          }
          const firstFile = fileInputRef.current?.files?.[0];
          const kind = getLimitKind(redirectUrl);
          setLimitInfo({
            filename: firstFile?.name ?? null,
            fileSizeBytes:
              kind === 'file_size' ? (firstFile?.size ?? null) : null,
            kind,
          });
          setZoneState('limitReached');
          return true;
        }
        return handleRedirect(request);
      }
      if (request.status === 202) {
        globalThis.location.href = '/downloads';
        return true;
      }
      if (request.status !== 200) {
        const cloned = request.clone();
        try {
          const body = await cloned.json();
          if (body?.error === 'needs_password') {
            const firstFile = fileInputRef.current?.files?.[0];
            if (firstFile) {
              setLockedPdfInfo({ filename: firstFile.name, file: firstFile });
              setPdfCredential('');
              setPdfUnlockError(null);
              setPdfAttemptCount(0);
              setZoneState('lockedPdf');
              return false;
            }
          }
        } catch {
          // non-JSON response — fall through to error
        }
        const message = await extractErrorMessage(request);
        setLocalError(message);
        setZoneState(zoneStateForUploadError(message));
        return false;
      }
      await applyConversionSuccess(request, conversionSuccessHandlers);
    } catch (error) {
      const isNetworkError =
        error instanceof TypeError ||
        (error instanceof Error && /fetch|network/i.test(error.message));
      track('upload_failed', {
        reason: isNetworkError ? 'network' : 'other',
        message: (error instanceof Error ? error.message : String(error)).slice(
          0,
          200
        ),
        fileSizeBytes: fileInputRef.current?.files?.[0]?.size ?? null,
        fileExt: (() => {
          const name = fileInputRef.current?.files?.[0]?.name ?? '';
          const dot = name.lastIndexOf('.');
          return dot >= 0 ? name.slice(dot).toLowerCase() : null;
        })(),
      });
      setLocalError(toFriendlyThrownError(error));
      setZoneState('error');
      return false;
    }
    return true;
  };

  const isExistingApkgReject =
    zoneState === 'error' &&
    localError != null &&
    /already an Anki deck/i.test(localError.message);

  const zoneClassName = [
    formStyles.dropZone,
    dropHover && zoneState === 'idle' ? formStyles.dropZoneActive : '',
    zoneState === 'converting' ? formStyles.dropZoneConverting : '',
    zoneState === 'success' || zoneState === 'multiDeck'
      ? formStyles.dropZoneSuccess
      : '',
    zoneState === 'emptyDeck' || zoneState === 'imageOnly'
      ? formStyles.dropZoneEmpty
      : '',
    zoneState === 'error' && !isExistingApkgReject
      ? formStyles.dropZoneError
      : '',
    isExistingApkgReject ? formStyles.dropZoneRedirect : '',
    zoneState === 'limitReached' ? formStyles.dropZoneLimit : '',
    zoneState === 'lockedPdf' ? formStyles.dropZoneLocked : '',
    isUploadLocked && zoneState === 'idle' ? formStyles.dropZoneLimitWall : '',
    validation?.status === 'warning' ? formStyles.dropZoneWarning : '',
    validation?.status === 'error' ? formStyles.dropZoneError : '',
    validation?.status === 'info' ? formStyles.dropZoneInfo : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderValidationState = () => (
    <div className={formStyles.stateContent}>
      <span className={formStyles.validationIcon}>
        {validation?.status === 'error' ? '⚠' : 'ℹ'}
      </span>
      <p className={formStyles.validationTitle}>{validation?.title}</p>
      <p className={formStyles.validationBody}>{validation?.body}</p>
      <div className={formStyles.validationActions}>
        <button
          type="button"
          className={formStyles.actionButton}
          onClick={(e) => {
            e.preventDefault();
            resetValidation();
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
          }}
        >
          Pick a different file
        </button>
        <button
          type="button"
          className={formStyles.resetLink}
          onClick={(e) => {
            e.preventDefault();
            resetValidation();
            submitFiles();
          }}
        >
          {validation?.continueLabel}
        </button>
      </div>
    </div>
  );

  const remoteSourceLabel = (): string | null => {
    if (driveFilename) return 'Google Drive';
    if (dropboxFilename) return 'Dropbox';
    return null;
  };

  const renderConvertingState = () => {
    const remoteFilename = driveFilename ?? dropboxFilename;
    const remoteSource = remoteSourceLabel();
    return (
      <div className={formStyles.stateContent}>
        <p className={formStyles.filename} data-hj-suppress>
          {remoteFilename ?? displayFilename(fileInputRef.current)}
        </p>
        <div className={formStyles.progressTrack}>
          <div
            className={`${formStyles.progressFill} ${progressSlow ? formStyles.progressFillSlow : ''}`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
        <p className={formStyles.statusText}>
          {remoteFilename && remoteSource
            ? t('upload.form.fetching', {
                filename: remoteFilename,
                source: remoteSource,
              })
            : t('upload.form.makingDeck')}
        </p>
      </div>
    );
  };

  const renderMcqDrawer = () => (
    <div className={formStyles.mcqDrawer}>
      <p className={formStyles.mcqDrawerHeading}>Preview</p>
      {mcqShowAnswer ? (
        <>
          <p className={formStyles.mcqDrawerQuestion}>
            Open your downloaded deck in Anki to see the full question and
            correct answer highlighted.
          </p>
          <button
            type="button"
            className={formStyles.mcqDrawerToggle}
            onClick={() => setMcqShowAnswer(false)}
          >
            Show question
          </button>
        </>
      ) : (
        <>
          <p className={formStyles.mcqDrawerQuestion}>
            Your deck contains {mcqCount} multiple-choice{' '}
            {mcqCount === 1 ? 'card' : 'cards'}. Each card shows a question stem
            with labelled options — tap the correct one in Anki to reveal the
            answer.
          </p>
          <button
            type="button"
            className={formStyles.mcqDrawerToggle}
            onClick={() => setMcqShowAnswer(true)}
          >
            Show answer
          </button>
        </>
      )}
    </div>
  );

  const successOffer = resolveSuccessOffer({
    anonymous: userLocals != null && userLocals.user?.email == null,
    paying: isPayingUser(userLocals?.locals),
  });

  const renderSuccessState = () => (
    <div className={formStyles.stateContent}>
      <CheckCircleIcon className={formStyles.iconSuccess} />
      {cardCount == null ? (
        <p className={formStyles.successPrimary}>
          {t('upload.form.deckReady')}
        </p>
      ) : (
        <ConversionResult variant="success" count={cardCount} />
      )}
      {mcqCount > 0 && (
        <>
          <button
            type="button"
            className={formStyles.mcqBadge}
            onClick={() => setMcqDrawerOpen((prev) => !prev)}
            aria-expanded={mcqDrawerOpen}
          >
            {t('upload.form.multipleChoice', { count: mcqCount })}
            {mcqSkippedCount > 0 && (
              <span
                className={formStyles.mcqSkipped}
                title="Mark the correct option in Notion to render these as multiple choice. Use a Notion checkbox or bold the correct bullet."
              >
                &nbsp;&mdash;&nbsp;{mcqSkippedCount} skipped, no answer marked
              </span>
            )}
          </button>
          {mcqDrawerOpen && renderMcqDrawer()}
        </>
      )}
      <p className={formStyles.successSecondary} data-hj-suppress>
        {t('upload.form.savedToDownloads', { deckName })}
      </p>
      {warningMessage && (
        <p className={formStyles.warningInline}>{warningMessage}</p>
      )}
      {droppedImageCount > 0 && (
        <div className={formStyles.warningInline}>
          <ImageDropNotice
            count={droppedImageCount}
            source={imageDropSource()}
            expiredCount={expiredNotionImageCount}
          />
        </div>
      )}
      {emptyBackCount > 0 && (
        <div className={formStyles.warningInline}>
          <EmptyBackNotice count={emptyBackCount} />
        </div>
      )}
      {overSplit && (
        <div className={formStyles.warningInline}>
          <OverSplitNotice cardCount={cardCount} />
        </div>
      )}
      {structureRescuedRule != null && (
        <div className={formStyles.warningInline}>
          <StructureRescuedNotice rule={structureRescuedRule} source="upload" />
        </div>
      )}
      {showFallback && (
        <button
          type="button"
          className={formStyles.fallbackLink}
          onClick={() => downloadRef.current?.click()}
        >
          {t('upload.form.fallbackDownload')}
        </button>
      )}
      {successOffer === 'anon_signup' && <CreateAccountNotice />}
      {successOffer === 'upsell' && (
        <UpsellCard surface="upload_success_upsell" hideForAnonymous />
      )}
      <button
        type="button"
        className={sharedStyles.btnSecondary}
        onClick={() => {
          fireAnalyticsEvent('make_another_deck_clicked');
          track('make_another_deck_clicked');
          resetForm();
        }}
      >
        {t('upload.form.makeAnother')}
      </button>
      <div className={formStyles.feedbackPrompt}>
        <p className={formStyles.feedbackLabel}>
          {t('upload.form.feedbackLabel')}
        </p>
        <FeedbackWidget page="/upload" compact />
      </div>
    </div>
  );

  const renderMultiDeckState = () => {
    if (batchResult == null) return null;
    const { decks, bulkUrl, deckCount, warning } = batchResult;
    const onDeckDownload = () => {
      fireAnalyticsEvent('deck_downloaded');
      track('deck_downloaded');
    };
    return (
      <div className={formStyles.stateContent}>
        <CheckCircleIcon className={formStyles.iconSuccess} />
        <p className={formStyles.successPrimary}>
          {t('upload.form.decksReady', { count: deckCount })}
        </p>
        {warning && <p className={formStyles.warningInline}>{warning}</p>}
        {droppedImageCount > 0 && (
          <div className={formStyles.warningInline}>
            <ImageDropNotice
              count={droppedImageCount}
              source={imageDropSource()}
              multipleDecks
              expiredCount={expiredNotionImageCount}
            />
          </div>
        )}
        {emptyBackCount > 0 && (
          <div className={formStyles.warningInline}>
            <EmptyBackNotice count={emptyBackCount} multipleDecks />
          </div>
        )}
        {structureRescuedRule != null && (
          <div className={formStyles.warningInline}>
            <StructureRescuedNotice
              rule={structureRescuedRule}
              source="upload"
            />
          </div>
        )}
        <ul className={formStyles.deckList}>
          {decks.map((deck) => (
            <li key={deck.filename} className={formStyles.deckRow}>
              <span
                className={formStyles.deckRowName}
                data-hj-suppress
                title={deck.name}
              >
                {deck.name}
              </span>
              <a
                href={deck.downloadUrl}
                download
                className={formStyles.deckRowDownload}
                aria-label={t('downloads.actions.downloadNamed', {
                  name: deck.name,
                })}
                onClick={onDeckDownload}
              >
                {t('upload.form.download')}
              </a>
            </li>
          ))}
        </ul>
        <a
          href={bulkUrl}
          download
          className={formStyles.actionButton}
          onClick={onDeckDownload}
        >
          {t('upload.form.downloadAll')}
        </a>
        <p className={formStyles.successSecondary}>
          {t('upload.form.linksExpire')}
        </p>
        <button
          type="button"
          className={formStyles.resetLink}
          onClick={resetForm}
        >
          {t('upload.form.makeMore')}
        </button>
      </div>
    );
  };

  const renderEmptyDeckBody = () => {
    if (localError?.code === 'markdown_likely_lossy') {
      return (
        <p className={formStyles.emptyBody}>
          Notion Markdown exports flatten toggles — re-export this page as HTML
          and the toggles become flashcards.
        </p>
      );
    }
    if (driveMimeType === 'application/vnd.google-apps.document') {
      return (
        <p className={formStyles.emptyBody}>
          Your Doc converted, but we didn't see the bullet shape we turn into
          cards. Restructure your Doc so each question is a top-level bullet
          with its answer indented underneath, then try again.{' '}
          <a href="/documentation/help/common-problems#my-google-doc-converted-to-0-cards">
            See a working example
          </a>
        </p>
      );
    }
    if (driveMimeType === 'application/vnd.google-apps.spreadsheet') {
      return (
        <p className={formStyles.emptyBody}>
          Sheets need a column of questions and a column of answers. Make sure
          your Sheet has at least two columns, then try again.
        </p>
      );
    }
    if (driveMimeType === 'application/vnd.google-apps.presentation') {
      return (
        <p className={formStyles.emptyBody}>
          Slides need a title and bullets per slide to produce cards. Add titles
          and bullet points to your slides, then try again.
        </p>
      );
    }
    if (/\.txt$/i.test(currentFilename())) {
      return (
        <p className={formStyles.emptyBody}>
          No cards in this file. For a text file, put one card per line as
          question - answer or question = answer, separate the two with a tab,
          or use a bullet list. See{' '}
          <a href="/documentation/help/common-problems">common problems</a> for
          the formats that work.
        </p>
      );
    }
    return (
      <p className={formStyles.emptyBody}>
        {t('upload.form.noCardsBody')}{' '}
        {t('upload.form.seeCommonProblemsPrefix')}
        <a href="/documentation/help/common-problems">
          {t('upload.form.commonProblems')}
        </a>
        {t('upload.form.seeCommonProblemsSuffix')}
      </p>
    );
  };

  const currentFilename = (): string =>
    driveFilename ?? dropboxFilename ?? displayFilename(fileInputRef.current);

  const imageDropSource = (): 'pdf' | 'upload' => {
    const remote = driveFilename ?? dropboxFilename;
    if (remote) {
      return remote.toLowerCase().endsWith('.pdf') ? 'pdf' : 'upload';
    }
    const files = Array.from(fileInputRef.current?.files ?? []);
    const allPdf =
      files.length > 0 &&
      files.every((f) => f.name.toLowerCase().endsWith('.pdf'));
    return allPdf ? 'pdf' : 'upload';
  };

  const renderEmptyDeckState = () => {
    const isGoogleDriveFile =
      driveMimeType?.startsWith('application/vnd.google-apps.') ?? false;
    const emptyTitle = isGoogleDriveFile
      ? t('upload.form.noCardsInFile', {
          filename: driveFilename ?? 'your file',
        })
      : t('upload.form.noCardsTitle');

    return (
      <div className={formStyles.stateContent}>
        <WarningIcon className={formStyles.iconWarning} />
        <p className={formStyles.emptyTitle}>{emptyTitle}</p>
        {renderEmptyDeckBody()}
        <div className={formStyles.emptyActions}>
          {downloadLink && (
            <button
              type="button"
              className={formStyles.emptyDownloadButton}
              onClick={() => downloadRef.current?.click()}
            >
              {t('upload.form.downloadEmpty')}
            </button>
          )}
          <button
            type="button"
            className={formStyles.resetLink}
            onClick={resetForm}
          >
            {t('upload.form.tryDifferent')}
          </button>
        </div>
      </div>
    );
  };

  const saveFilenameForReattach = (filename: string | null) => {
    if (filename != null && filename.length > 0) {
      globalThis.sessionStorage?.setItem('upload_pending_filename', filename);
    }
  };

  const renderLimitState = () => {
    const isFileSize = limitInfo?.kind === 'file_size';
    const cardsUsed = cardUsage?.cards_used ?? 0;
    let title: string;
    if (isFileSize) {
      title = 'This file is over the 100 MB limit';
    } else if (cardsUsed >= 100) {
      title = "You've used all 100 cards this month";
    } else {
      title = 'This conversion is over your free limit of 100 cards a month';
    }
    const limitContext = showSignInPrompt ? 'anonymous' : 'logged_in';
    const description = getLimitDescription(
      isFileSize ? 'file_size' : 'card_count',
      limitContext
    );
    const displayedFilename = decodeFilename(limitInfo?.filename ?? null);

    return (
      <div className={formStyles.limitContent}>
        <p className={formStyles.limitTitle}>{title}</p>
        <p className={formStyles.limitDescription}>{description}</p>
        {displayedFilename && (
          <span
            className={formStyles.limitFilename}
            title={displayedFilename}
            data-hj-suppress
          >
            {displayedFilename}
            {isFileSize && limitInfo?.fileSizeBytes != null && (
              <> &mdash; {formatFileSize(limitInfo.fileSizeBytes)}</>
            )}
          </span>
        )}
        {dayPassError && (
          <p className={formStyles.limitError} role="alert">
            {dayPassError}
          </p>
        )}
        <div className={formStyles.limitActions}>
          {showSignInPrompt ? (
            <Link
              to="/register?redirect=/upload"
              className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
              onClick={() =>
                saveFilenameForReattach(limitInfo?.filename ?? null)
              }
            >
              Create a free account
            </Link>
          ) : (
            <>
              <button
                type="button"
                className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
                onClick={handleDayPass}
                disabled={dayPassPending}
              >
                {dayPassPending ? 'Starting checkout' : 'Get Day Pass — $4'}
              </button>
              <Link
                to="/limit?ref=upload-limit-wall"
                className={`${sharedStyles.btnSecondary} ${sharedStyles.btnInline}`}
              >
                See plans
              </Link>
            </>
          )}
          <button
            type="button"
            className={formStyles.resetLink}
            onClick={resetForm}
          >
            Try a different file
          </button>
        </div>
      </div>
    );
  };

  const renderPackagingState = () => (
    <div className={formStyles.stateContent}>
      <p className={formStyles.filename} data-hj-suppress>
        {folderName}
      </p>
      <div className={formStyles.progressTrack}>
        <div className={formStyles.progressFillIndeterminate} />
      </div>
      <p className={formStyles.statusText}>{t('upload.form.packingFolder')}</p>
    </div>
  );

  // Folder-packaging failures happen before any server job exists, so the
  // status-page link and error chat the server error state offers would have
  // nothing to point at — this render keeps it to the sentence and a reset.
  const renderFolderErrorState = (kind: 'tooBig' | 'empty' | 'failed') => {
    const messageKey = {
      tooBig: 'upload.form.folderTooBig',
      empty: 'upload.form.folderEmpty',
      failed: 'upload.form.folderFailed',
    }[kind];
    return (
      <div className={formStyles.stateContent}>
        <WarningIcon className={formStyles.iconError} />
        <p className={formStyles.errorBody}>{t(messageKey)}</p>
        <button
          type="button"
          className={formStyles.actionButton}
          onClick={() => {
            setFolderError(null);
            resetForm();
          }}
        >
          {t('upload.form.tryDifferent')}
        </button>
      </div>
    );
  };

  const renderErrorState = () => {
    const isExistingApkg =
      localError != null && /already an Anki deck/i.test(localError.message);
    if (isExistingApkg) {
      return (
        <div className={formStyles.stateContent}>
          <p className={formStyles.apkgRedirectHeading}>
            That&apos;s already an Anki deck
          </p>
          <p className={formStyles.apkgRedirectIntro}>
            Print it as a PDF for offline study.
          </p>
          <div className={formStyles.apkgRedirectActions}>
            <Link to="/print" className={formStyles.apkgRedirectPrimary}>
              <span className={formStyles.apkgRedirectActionLabel}>
                Print as PDF →
              </span>
              <span className={formStyles.apkgRedirectActionHint}>
                Export your deck as a printable PDF for offline study.
              </span>
            </Link>
          </div>
          <button
            type="button"
            className={formStyles.resetLink}
            onClick={resetForm}
          >
            Pick a different file
          </button>
        </div>
      );
    }
    const classified = localError
      ? classifyUploadError(localError)
      : {
          title: 'Something broke while reading this file.',
          detail:
            'Try again, or send the file to support@2anki.net so we can fix the parser.',
        };
    const errorText = classified.detail
      ? `${classified.title} ${classified.detail}`
      : classified.title;
    return (
      <div className={formStyles.stateContent}>
        <WarningIcon className={formStyles.iconError} />
        <p className={formStyles.errorTitle}>{t('upload.form.errorTitle')}</p>
        <p className={formStyles.errorBody}>{errorText}</p>
        <p className={formStyles.statusLink}>
          {t('conversionResult.checkStatusPrefix')}
          <Link to="/status">{t('conversionResult.checkStatus')}</Link>
        </p>
        <button
          type="button"
          className={formStyles.actionButton}
          onClick={resetForm}
        >
          {t('upload.form.tryAgain')}
        </button>
      </div>
    );
  };

  const renderIdleState = () => (
    <div className={formStyles.stateContent}>
      <UploadCloudIcon className={formStyles.icon} />
      <span className={formStyles.dropText}>
        {dropHover
          ? t('upload.dropzone.dropActive')
          : t('upload.dropzone.dropIdle')}
      </span>
      {!dropHover && (
        <>
          <span className={formStyles.dropHint}>{t('upload.dropzone.or')}</span>
          <span className={formStyles.chooseButton}>
            {t('upload.dropzone.chooseFiles')}
          </span>
          <div className={formStyles.formatList}>
            {FORMATS.map((fmt) => (
              <span key={fmt} className={formStyles.formatPill}>
                {fmt}
              </span>
            ))}
          </div>
          <span className={formStyles.shapeHint}>
            {t('upload.dropzone.csvHint')}
          </span>
          <span className={formStyles.shapeHint}>
            {t('upload.dropzone.folderHint')}
          </span>
        </>
      )}
    </div>
  );

  const handleUnlock = async () => {
    if (!lockedPdfInfo) return;

    const credential = pdfCredential.trim();
    if (!credential) return;

    setZoneState('converting');
    setPdfUnlockError(null);

    try {
      const formData = new FormData();
      formData.append('file', lockedPdfInfo.file, lockedPdfInfo.filename);
      formData.append('credential', credential);
      for (const [key, value] of Object.entries(globalThis.localStorage)) {
        formData.append(key, value);
      }

      const request = await globalThis.fetch(
        '/api/upload/retry-with-credential',
        {
          method: 'post',
          body: formData,
        }
      );

      if (request.status === 200) {
        setLockedPdfInfo(null);
        await applyConversionSuccess(request, conversionSuccessHandlers);
        return;
      }

      const newAttemptCount = pdfAttemptCount + 1;
      setPdfAttemptCount(newAttemptCount);
      setPdfUnlockError(
        "That didn't open the file. Check for typos and try again."
      );
      setZoneState('lockedPdf');
    } catch (error) {
      setPdfUnlockError(toFriendlyThrownError(error).message);
      setZoneState('lockedPdf');
    }
  };

  const renderLockedPdfState = () => (
    <div className={formStyles.stateContent}>
      <span className={formStyles.lockedIcon} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="40"
          height="40"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </span>
      <div className={formStyles.lockedBadge}>Locked</div>
      <p className={formStyles.lockedFilename} data-hj-suppress>
        {lockedPdfInfo?.filename}
      </p>
      <p className={formStyles.lockedHeadline}>
        This PDF is password-protected
      </p>
      <div className={formStyles.lockedInputRow}>
        <input
          type="password"
          className={formStyles.lockedInput}
          placeholder="Enter password"
          value={pdfCredential}
          autoFocus
          onChange={(e) => setPdfCredential(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleUnlock();
          }}
          aria-label="PDF password"
        />
        <button
          type="button"
          className={formStyles.lockedUnlockButton}
          onClick={handleUnlock}
          disabled={!pdfCredential.trim()}
        >
          Unlock
        </button>
      </div>
      {pdfUnlockError && (
        <p className={formStyles.lockedError} role="alert">
          {pdfUnlockError}
        </p>
      )}
      {pdfAttemptCount >= 3 && (
        <p className={formStyles.lockedHint}>
          Still stuck? Some PDFs have owner-only protection that can't be
          entered here — open the file in Preview or Adobe Reader, save a copy,
          and upload that.
        </p>
      )}
      <button
        type="button"
        className={formStyles.resetLink}
        onClick={resetForm}
      >
        Skip this file
      </button>
    </div>
  );

  const renderLockedState = () => {
    const used = cardUsage?.cards_used ?? 0;
    const limit = cardUsage?.cards_limit ?? 100;
    const now = new Date();
    const resetsOn = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1
    ).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    return (
      <div className={formStyles.limitContent}>
        <span className={formStyles.lockedIcon} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="28"
            height="28"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <p className={formStyles.limitTitle}>
          You&apos;ve used all {limit} cards this month
        </p>
        <p className={formStyles.limitDescription}>
          {used} / {limit} cards · resets {resetsOn}, when your free cards come
          back
        </p>
        {dayPassError && (
          <p className={formStyles.limitError} role="alert">
            {dayPassError}
          </p>
        )}
        <div className={formStyles.limitActions}>
          <button
            type="button"
            className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
            onClick={handleDayPass}
            disabled={dayPassPending}
          >
            {dayPassPending ? 'Starting checkout' : 'Get Day Pass — $4'}
          </button>
          <Link
            to="/limit?ref=upload-limit-wall"
            className={`${sharedStyles.btnSecondary} ${sharedStyles.btnInline}`}
          >
            See plans
          </Link>
        </div>
      </div>
    );
  };

  const renderImageOnlyState = () => (
    <div className={formStyles.stateContent}>
      <WarningIcon className={formStyles.iconWarning} />
      <p className={formStyles.emptyTitle}>{t('upload.form.imagesTitle')}</p>
      <p className={formStyles.emptyBody}>{t('upload.form.imagesBody')}</p>
      <div className={formStyles.emptyActions}>
        <Link
          to="/photo-to-deck"
          className={formStyles.actionButton}
          onClick={() => track('image_only_photo_deck_clicked')}
        >
          {t('upload.form.tryPhotoToDeck')}
        </Link>
        <button
          type="button"
          className={formStyles.resetLink}
          onClick={resetForm}
        >
          {t('upload.form.tryDifferent')}
        </button>
      </div>
    </div>
  );

  const renderZoneContent = () => {
    if (isUploadLocked && zoneState === 'idle') return renderLockedState();
    if (validation && zoneState === 'idle') return renderValidationState();
    if (zoneState === 'converting') return renderConvertingState();
    if (zoneState === 'success') return renderSuccessState();
    if (zoneState === 'multiDeck') return renderMultiDeckState();
    if (zoneState === 'emptyDeck') return renderEmptyDeckState();
    if (zoneState === 'imageOnly') return renderImageOnlyState();
    if (zoneState === 'limitReached' && limitInfo) return renderLimitState();
    if (zoneState === 'lockedPdf') return renderLockedPdfState();
    if (zoneState === 'packaging') return renderPackagingState();
    if (zoneState === 'error' && folderError != null) {
      return renderFolderErrorState(folderError);
    }
    if (zoneState === 'error') return renderErrorState();
    return renderIdleState();
  };

  const showChips = zoneState === 'idle' && !validation && !isUploadLocked;
  const showDropboxPanel = showChips && source === 'dropbox';
  const showGoogleDrivePanel = showChips && source === 'google_drive';
  const showLocalPanel = !showChips || source === 'local';

  const renderLiveStatus = (): string => {
    if (zoneState === 'packaging') return t('upload.form.packingFolder');
    if (zoneState === 'converting') return 'Converting your file.';
    if (zoneState === 'success') {
      if (cardCount == null) return 'Your deck is ready.';
      const noun = cardCount === 1 ? 'card' : 'cards';
      return `Your deck is ready — ${cardCount} ${noun}.`;
    }
    if (zoneState === 'multiDeck') {
      const n = batchResult?.deckCount ?? 0;
      return `${n} ${n === 1 ? 'deck' : 'decks'} ready.`;
    }
    if (zoneState === 'emptyDeck') {
      return 'Conversion finished, but no cards were found.';
    }
    if (zoneState === 'imageOnly') {
      return 'These look like images. Try Photo to Deck to turn them into cards.';
    }
    if (zoneState === 'error') return 'Conversion failed.';
    if (zoneState === 'limitReached') {
      return "You've reached your monthly limit.";
    }
    if (zoneState === 'lockedPdf') {
      return 'This PDF is password-protected. Enter the password to continue.';
    }
    return '';
  };

  return (
    <form encType="multipart/form-data" method="post" onSubmit={handleSubmit}>
      <output aria-live="polite" className={sharedStyles.srOnly}>
        {renderLiveStatus()}
      </output>
      <label
        htmlFor="pakker"
        id="upload-panel-local"
        translate="no"
        className={`${zoneClassName} ${showLocalPanel ? '' : formStyles.panelHidden}`}
        aria-hidden={!showLocalPanel}
      >
        {renderZoneContent()}
        <input
          ref={fileInputRef}
          className={formStyles.fileInput}
          id="pakker"
          type="file"
          name="pakker"
          accept={getAcceptedContentTypes()}
          required
          multiple
          disabled={isUploadLocked}
          onChange={() => {
            const files = fileInputRef.current?.files;
            if (files && validate(files)) {
              submitFiles();
            }
          }}
        />
      </label>
      {zoneState === 'emptyDeck' && (
        <div className={formStyles.inlineChatWrapper}>
          <button
            type="button"
            className={formStyles.inlineChatToggle}
            onClick={() => {
              setShowInlineChat((prev) => {
                if (!prev) track('upload_empty_deck_chat_engaged');
                return !prev;
              });
            }}
            aria-expanded={showInlineChat}
            aria-controls="empty-deck-chat-panel"
          >
            <i
              className={`${formStyles.inlineChatToggleChevron} ${showInlineChat ? formStyles.inlineChatToggleChevronOpen : ''}`}
              aria-hidden="true"
            >
              ›
            </i>
            Ask Claude about this file
          </button>
          {showInlineChat && (
            <section
              id="empty-deck-chat-panel"
              className={formStyles.inlineChatBody}
              aria-label={`Ask Claude about ${currentFilename() || 'this file'}`}
            >
              <p className={formStyles.inlineChatContext}>
                About{' '}
                <span
                  className={formStyles.inlineChatFilename}
                  title={currentFilename() || 'your file'}
                >
                  {currentFilename() || 'your file'}
                </span>
              </p>
              <ChatPanel
                key={currentFilename()}
                initialPrompt={getEmptyDeckChatPrompt(
                  driveMimeType,
                  currentFilename()
                )}
                cameFromUpload
              />
            </section>
          )}
        </div>
      )}
      {zoneState === 'error' && (
        <div className={formStyles.inlineChatWrapper}>
          <button
            type="button"
            className={formStyles.inlineChatToggle}
            onClick={() => {
              setShowErrorInlineChat((prev) => {
                if (!prev) track('upload_error_chat_engaged');
                return !prev;
              });
            }}
            aria-expanded={showErrorInlineChat}
            aria-controls="error-state-chat-panel"
          >
            <i
              className={`${formStyles.inlineChatToggleChevron} ${showErrorInlineChat ? formStyles.inlineChatToggleChevronOpen : ''}`}
              aria-hidden="true"
            >
              ›
            </i>
            {showErrorInlineChat ? 'Hide chat' : 'Talk it through instead'}
          </button>
          {showErrorInlineChat && (
            <section
              id="error-state-chat-panel"
              className={formStyles.inlineChatBody}
              aria-label={`Talk to Claude about ${currentFilename() || 'this file'}`}
            >
              <p className={formStyles.inlineChatContext}>
                About{' '}
                <span
                  className={formStyles.inlineChatFilename}
                  title={currentFilename() || 'your file'}
                >
                  {currentFilename() || 'your file'}
                </span>
              </p>
              <ChatPanel
                key={`error-${currentFilename()}`}
                initialPrompt={`I tried to convert ${currentFilename() || 'a file'} and got stuck. What can I do?`}
                cameFromUpload
              />
            </section>
          )}
        </div>
      )}
      {showChips && (
        <div
          id="upload-panel-dropbox"
          className={`${zoneClassName} ${showDropboxPanel ? '' : formStyles.panelHidden}`}
          aria-hidden={!showDropboxPanel}
        >
          <div className={formStyles.stateContent}>
            <button
              type="button"
              className={formStyles.changeSourceLink}
              aria-label="Change upload source"
              onClick={() => handleSourceChange('local')}
            >
              {t('upload.form.changeSource')}
            </button>
            <DropboxIcon className={formStyles.dropboxIconLarge} />
            <span className={formStyles.dropText}>
              {t('upload.form.dropboxPrompt')}
            </span>
            <button
              type="button"
              className={formStyles.chooseButton}
              onClick={handleDropboxClick}
              disabled={dropboxPending}
              aria-label="Choose from Dropbox"
            >
              {dropboxPending
                ? t('upload.form.openingDropbox')
                : t('upload.form.chooseFromDropbox')}
            </button>
            <div className={formStyles.formatList}>
              {FORMATS.map((fmt) => (
                <span key={fmt} className={formStyles.formatPill}>
                  {fmt}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {dropboxError && (
        <p className={formStyles.dropboxError} role="alert">
          {dropboxError}
        </p>
      )}
      {showChips && isGoogleDriveConfigured && (
        <div
          id="upload-panel-google-drive"
          className={`${zoneClassName} ${showGoogleDrivePanel ? '' : formStyles.panelHidden}`}
          aria-hidden={!showGoogleDrivePanel}
        >
          <div className={formStyles.stateContent}>
            <button
              type="button"
              className={formStyles.changeSourceLink}
              aria-label="Change upload source"
              onClick={() => handleSourceChange('local')}
            >
              {t('upload.form.changeSource')}
            </button>
            <GoogleDriveIcon className={formStyles.dropboxIconLarge} />
            <span className={formStyles.dropText}>
              {t('upload.form.drivePrompt')}
            </span>
            <span className={formStyles.shapeHint}>
              {t('upload.form.driveHint')}
            </span>
            <button
              ref={driveButtonRef}
              type="button"
              className={formStyles.chooseButton}
              onClick={handleGoogleDriveClick}
              disabled={drivePending}
              aria-label="Choose from Google Drive"
            >
              {drivePending
                ? t('upload.form.openingDrive')
                : t('upload.form.chooseFromDrive')}
            </button>
            <div className={formStyles.formatList}>
              {FORMATS.map((fmt) => (
                <span key={fmt} className={formStyles.formatPill}>
                  {fmt}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {driveError && (
        <p className={formStyles.dropboxError} role="alert">
          {driveError}
        </p>
      )}
      {showChips && (
        <div className={formStyles.chipsRow}>
          <UploadSourceChips
            active={source}
            onChange={handleSourceChange}
            dropboxAvailable={isDropboxConfigured}
            googleDriveAvailable={isGoogleDriveConfigured}
          />
        </div>
      )}
      {downloadLink && (
        <a
          hidden
          target="_blank"
          aria-label="download link"
          href={downloadLink}
          download={getDownloadFileName(deckName || 'Untitled')}
          ref={downloadRef}
          rel="noreferrer"
        >
          {downloadLink}
        </a>
      )}
      <button
        aria-label="Upload file"
        className={sharedStyles.hidden}
        ref={convertRef}
        type="submit"
      />
    </form>
  );
}

export default UploadForm;

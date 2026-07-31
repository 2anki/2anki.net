import { useState } from 'react';
import type { UploadErrorBody } from '../../../../../types/UploadErrorBody';
import type { StructureRescueRule } from '../../../../DownloadsPage/helpers/parseStructureRescuedPayload';
import type { UploadSource } from '../UploadSourceChips';

export type ZoneState =
  | 'idle'
  | 'converting'
  | 'success'
  | 'multiDeck'
  | 'emptyDeck'
  | 'imageOnly'
  | 'limitReached'
  | 'error'
  | 'lockedPdf';

export interface BatchDeck {
  name: string;
  filename: string;
  downloadUrl: string;
}

export interface BatchResult {
  workspaceId: string;
  deckCount: number;
  decks: BatchDeck[];
  bulkUrl: string;
  warning?: string;
  droppedImageCount?: number;
  emptyBackCount?: number;
  structureRescuedRule?: string;
}

export interface LockedPdfInfo {
  filename: string;
  file: File;
}

export interface LimitInfo {
  filename: string | null;
  fileSizeBytes: number | null;
  kind: 'file_size' | 'card_count';
}

export function useUploadFormState(onReset: () => void) {
  const [zoneState, setZoneState] = useState<ZoneState>('idle');
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [downloadLink, setDownloadLink] = useState<string | null>(null);
  const [deckName, setDeckName] = useState('');
  const [cardCount, setCardCount] = useState<number | null>(null);
  const [mcqCount, setMcqCount] = useState<number>(0);
  const [mcqSkippedCount, setMcqSkippedCount] = useState<number>(0);
  const [droppedImageCount, setDroppedImageCount] = useState<number>(0);
  const [emptyBackCount, setEmptyBackCount] = useState<number>(0);
  const [overSplit, setOverSplit] = useState(false);
  const [structureRescuedRule, setStructureRescuedRule] =
    useState<StructureRescueRule | null>(null);
  const [mcqDrawerOpen, setMcqDrawerOpen] = useState(false);
  const [mcqShowAnswer, setMcqShowAnswer] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [limitInfo, setLimitInfo] = useState<LimitInfo | null>(null);
  const [localError, setLocalError] = useState<UploadErrorBody | null>(null);
  const [progressWidth, setProgressWidth] = useState(10);
  const [progressSlow, setProgressSlow] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [dropboxFilename, setDropboxFilename] = useState<string | null>(null);
  const [dropboxPending, setDropboxPending] = useState(false);
  const [dropboxError, setDropboxError] = useState<string | null>(null);
  const [driveFilename, setDriveFilename] = useState<string | null>(null);
  const [driveMimeType, setDriveMimeType] = useState<string | null>(null);
  const [drivePending, setDrivePending] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [source, setSource] = useState<UploadSource>('local');
  const [showInlineChat, setShowInlineChat] = useState(false);
  const [showErrorInlineChat, setShowErrorInlineChat] = useState(false);
  const [lockedPdfInfo, setLockedPdfInfo] = useState<LockedPdfInfo | null>(
    null
  );
  const [pdfCredential, setPdfCredential] = useState('');
  const [pdfUnlockError, setPdfUnlockError] = useState<string | null>(null);
  const [pdfAttemptCount, setPdfAttemptCount] = useState(0);

  const resetForm = () => {
    setZoneState('idle');
    setBatchResult(null);
    setDownloadLink(null);
    setDeckName('');
    setCardCount(null);
    setMcqCount(0);
    setMcqSkippedCount(0);
    setDroppedImageCount(0);
    setEmptyBackCount(0);
    setOverSplit(false);
    setStructureRescuedRule(null);
    setMcqDrawerOpen(false);
    setMcqShowAnswer(false);
    setWarningMessage(null);
    setLimitInfo(null);
    setLocalError(null);
    setProgressWidth(10);
    setProgressSlow(false);
    setShowFallback(false);
    setDropboxFilename(null);
    setDropboxError(null);
    setDriveFilename(null);
    setDriveMimeType(null);
    setDriveError(null);
    setSource('local');
    setShowInlineChat(false);
    setShowErrorInlineChat(false);
    setLockedPdfInfo(null);
    setPdfCredential('');
    setPdfUnlockError(null);
    setPdfAttemptCount(0);
    onReset();
  };

  return {
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
    setDroppedImageCount,
    emptyBackCount,
    setEmptyBackCount,
    overSplit,
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
  };
}

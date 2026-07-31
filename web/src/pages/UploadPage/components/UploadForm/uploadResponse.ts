import getHeadersFilename from '../../helpers/getHeadersFilename';
import {
  STRUCTURE_RESCUE_RULES,
  type StructureRescueRule,
} from '../../../DownloadsPage/helpers/parseStructureRescuedPayload';
import type { BatchResult, ZoneState } from './hooks/useUploadFormState';

export function resolveDeckName(headers: Headers): string {
  const fileNameHeader = getHeadersFilename(headers);
  const fallback =
    headers.get('Content-Type') === 'application/zip'
      ? 'Your Decks.zip'
      : 'Your deck.apkg';
  return fileNameHeader ?? fallback;
}

export function parseCardCountHeader(headers: Headers): number | null {
  const cardCountHeader = headers.get('X-Card-Count');
  if (!cardCountHeader) return null;
  const parsed = Number.parseInt(cardCountHeader, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseNonNegativeIntHeader(
  headers: Headers,
  name: string
): number {
  const raw = headers.get(name);
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export interface ConversionSuccessHandlers {
  setWarningMessage: (value: string | null) => void;
  setDeckName: (value: string) => void;
  setCardCount: (value: number | null) => void;
  setMcqCount: (value: number) => void;
  setMcqSkippedCount: (value: number) => void;
  setDroppedImageCount: (value: number) => void;
  setEmptyBackCount: (value: number) => void;
  setOverSplit: (value: boolean) => void;
  setDownloadLink: (value: string | null) => void;
  setProgressWidth: (value: number) => void;
  setBatchResult: (value: BatchResult) => void;
  setZoneState: (value: ZoneState) => void;
  setStructureRescuedRule: (value: StructureRescueRule | null) => void;
}

export function parseStructureRescuedValue(
  value: unknown
): StructureRescueRule | null {
  return typeof value === 'string' &&
    (STRUCTURE_RESCUE_RULES as readonly string[]).includes(value)
    ? (value as StructureRescueRule)
    : null;
}

function isBatchResult(value: unknown): value is BatchResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'batch' &&
    Array.isArray((value as { decks?: unknown }).decks)
  );
}

export async function applyConversionSuccess(
  response: Response,
  handlers: ConversionSuccessHandlers
): Promise<void> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const body: unknown = await response.json();
    if (isBatchResult(body)) {
      handlers.setBatchResult(body);
      handlers.setDroppedImageCount(body.droppedImageCount ?? 0);
      handlers.setEmptyBackCount(body.emptyBackCount ?? 0);
      handlers.setStructureRescuedRule(
        parseStructureRescuedValue(body.structureRescuedRule)
      );
      handlers.setProgressWidth(100);
      handlers.setZoneState('multiDeck');
      return;
    }
  }

  handlers.setWarningMessage(response.headers.get('X-Warning'));
  handlers.setDeckName(resolveDeckName(response.headers));
  const count = parseCardCountHeader(response.headers);
  handlers.setCardCount(count);
  handlers.setMcqCount(
    parseNonNegativeIntHeader(response.headers, 'X-MCQ-Count')
  );
  handlers.setMcqSkippedCount(
    parseNonNegativeIntHeader(response.headers, 'X-MCQ-Skipped-Count')
  );
  handlers.setDroppedImageCount(
    parseNonNegativeIntHeader(response.headers, 'X-Dropped-Assets')
  );
  handlers.setEmptyBackCount(
    parseNonNegativeIntHeader(response.headers, 'X-Empty-Back-Count')
  );
  handlers.setOverSplit(response.headers.get('X-Over-Split') === '1');
  handlers.setStructureRescuedRule(
    parseStructureRescuedValue(response.headers.get('X-Structure-Rescued'))
  );
  const blob = await response.blob();
  handlers.setDownloadLink(globalThis.URL.createObjectURL(blob));
  handlers.setProgressWidth(100);
  if (count === 0) {
    handlers.setZoneState('emptyDeck');
  } else {
    handlers.setZoneState('success');
  }
}

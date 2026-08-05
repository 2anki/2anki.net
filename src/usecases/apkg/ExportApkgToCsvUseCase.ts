import { parseApkgNotes } from '../../services/ApkgPreviewService/parseApkgNotes';
import { buildCsvFromApkgNotes } from '../../lib/csv/buildCsvFromApkgNotes';

export const CSV_FREE_NOTE_LIMIT = 100;

// Anonymous visitors get a smaller allowance than a free account, so signing in
// still buys something on this page. Deliberately a separate constant from the
// main converter's ANONYMOUS_CARD_CAP even though both are 21 — they are equal
// by coincidence, not by rule, and coupling them would make one move the other.
export const CSV_ANONYMOUS_NOTE_LIMIT = 21;

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export class EmptyDeckError extends Error {
  constructor() {
    super('No notes found in this .apkg file.');
    this.name = 'EmptyDeckError';
  }
}

export class CardLimitExceededError extends Error {
  constructor(
    public readonly noteCount: number,
    public readonly noteLimit: number
  ) {
    // The user-facing wording lives in the client, which knows whether to offer
    // signing in or upgrading. This message is for logs; the numbers travel on
    // the error so the client can name the real count and the applicable cap.
    super(`${noteCount} notes exceeds the ${noteLimit} note limit.`);
    this.name = 'CardLimitExceededError';
  }
}

export interface ExportApkgToCsvResult {
  csv: Buffer;
  deckName: string;
  noteCount: number;
}

export default class ExportApkgToCsvUseCase {
  /**
   * @param noteLimit the caller's applicable cap, or null for unlimited. A
   * number rather than a boolean because there are three tiers now: anonymous,
   * free account, and paid.
   */
  async execute(
    fileBuffer: Buffer,
    noteLimit: number | null
  ): Promise<ExportApkgToCsvResult> {
    const parsed = await parseApkgNotes(fileBuffer);
    if (parsed.notes.length === 0) {
      throw new EmptyDeckError();
    }
    // `!= null` rather than a truthy check, so a cap of 0 stays a cap.
    if (noteLimit != null && parsed.notes.length > noteLimit) {
      throw new CardLimitExceededError(parsed.notes.length, noteLimit);
    }
    const csvText = buildCsvFromApkgNotes(parsed.notes);
    const csv = Buffer.concat([UTF8_BOM, Buffer.from(csvText, 'utf8')]);
    return {
      csv,
      deckName: parsed.deckName,
      noteCount: parsed.notes.length,
    };
  }
}

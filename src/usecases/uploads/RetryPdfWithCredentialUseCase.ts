import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import Workspace from '../../lib/parser/WorkSpace';
import CardOption from '../../lib/parser/Settings';
import { isPdfPasswordSentinel } from '../../lib/pdf/pdfPasswordSentinel';
import { processUploadedPdf } from './processUploadedPdf';
import {
  isLockedPdfError,
  isUnreadablePdfError,
  PDF_UNREADABLE_REASON,
} from '../jobs/jobFailureReason';
import type UsersRepository from '../../data_layer/UsersRepository';
import {
  ANONYMOUS_CARD_CAP,
  MONTHLY_CARD_LIMIT,
} from '../users/CheckMonthlyCardLimitUseCase';

export interface RetryPdfResult {
  apkg: Buffer;
  cardCount: number;
  name: string;
}

export interface RetryPdfNeedsCredential {
  needsCredential: true;
  reason: 'wrong_password';
}

export interface RetryPdfLimitReached {
  limitReached: 'card_count' | 'anonymous';
  cardCount: number;
}

export interface RetryPdfUnreadable {
  unreadable: string;
}

export type RetryPdfOutcome =
  | RetryPdfResult
  | RetryPdfNeedsCredential
  | RetryPdfLimitReached
  | RetryPdfUnreadable;

// The image fallback reopens the PDF without the password, so a scanned file
// that opened fine still fails here with pdfinfo's raw text.
export const LOCKED_PDF_UNREADABLE_REASON =
  "We can't make cards from this locked PDF. Remove the password, save a copy, and upload that.";

export type CardUsage = Pick<
  UsersRepository,
  'getCardUsage' | 'incrementCardUsage'
>;

export class RetryPdfWithCredentialUseCase {
  constructor(private readonly cardUsage?: CardUsage) {}

  async execute(
    fileBuffer: Buffer,
    filename: string,
    credential: string,
    paying: boolean,
    settings: CardOption,
    workspace: Workspace,
    userId: number | null = null,
    anonymousPassId: number | null = null
  ): Promise<RetryPdfOutcome> {
    try {
      const result = await PrepareDeck({
        name: filename,
        files: [{ name: filename, contents: fileBuffer }],
        settings: processUploadedPdf(filename, settings),
        noLimits: paying,
        workspace,
        userId,
        anonymousPassId,
        pdfCredential: credential,
      });

      if (result == null) {
        throw new Error('PDF conversion produced no cards');
      }

      // The same limits an ordinary upload checks after converting: once the
      // password opens the PDF, the retry must not be a way around them.
      if (!paying) {
        const limitReached = await this.checkFreeLimits(
          userId,
          result.cardCount
        );
        if (limitReached != null) {
          return { limitReached, cardCount: result.cardCount };
        }
      }

      return {
        apkg: result.apkg,
        cardCount: result.cardCount,
        name: result.name,
      };
    } catch (error) {
      if (error instanceof Error && isPdfPasswordSentinel(error.message)) {
        return { needsCredential: true, reason: 'wrong_password' };
      }
      if (isLockedPdfError(error)) {
        return { unreadable: LOCKED_PDF_UNREADABLE_REASON };
      }
      if (isUnreadablePdfError(error)) {
        return { unreadable: PDF_UNREADABLE_REASON };
      }
      throw error;
    }
  }

  private async checkFreeLimits(
    userId: number | null,
    cardCount: number
  ): Promise<RetryPdfLimitReached['limitReached'] | null> {
    if (userId == null) {
      return cardCount > ANONYMOUS_CARD_CAP ? 'anonymous' : null;
    }
    if (this.cardUsage == null) {
      return 'card_count';
    }
    const { cards_used } = await this.cardUsage.getCardUsage(userId);
    if (cards_used + cardCount > MONTHLY_CARD_LIMIT) {
      return 'card_count';
    }
    await this.cardUsage.incrementCardUsage(userId, cardCount);
    return null;
  }
}

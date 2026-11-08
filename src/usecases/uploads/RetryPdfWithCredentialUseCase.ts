import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import Workspace from '../../lib/parser/WorkSpace';
import CardOption from '../../lib/parser/Settings';
import { isPdfPasswordSentinel } from '../../lib/pdf/pdfPasswordSentinel';
import { processUploadedPdf } from './processUploadedPdf';
import {
  isLockedPdfError,
  isUnreadablePdfError,
  jobFailureReasonCode,
  PDF_UNREADABLE_REASON,
} from '../jobs/jobFailureReason';
import { PDF_EXCEEDS_MAX_PAGE_LIMIT } from '../../infrastracture/adapters/fileConversion/convertPDFToImages';
import { HttpCodedError } from '../../lib/errors/HttpCodedError';
import {
  EMPTY_CONTENT_USER_MESSAGE,
  LARGE_SECTION_USER_MESSAGE,
} from '../../lib/claude/ClaudeService';
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
  code: 'password_protected_pdf' | 'pdf_processing_failed';
}

export type RetryPdfOutcome =
  | RetryPdfResult
  | RetryPdfNeedsCredential
  | RetryPdfLimitReached
  | RetryPdfUnreadable;

// A locked-PDF error that reaches the route without becoming the password
// sentinel; the page-image path converts its own into the sentinel.
export const LOCKED_PDF_UNREADABLE_REASON =
  "We can't make cards from this locked PDF. Remove the password, save a copy, and upload that.";

export type CardUsage = Pick<
  UsersRepository,
  'getCardUsage' | 'incrementCardUsage'
>;

const NO_CARDS_MESSAGE = 'PDF conversion produced no cards';

// The chunk runner rewraps a failed chunk as a plain Error with this text.
const WRITTEN_FOR_THE_PERSON = new Set([
  PDF_EXCEEDS_MAX_PAGE_LIMIT,
  NO_CARDS_MESSAGE,
  LARGE_SECTION_USER_MESSAGE,
  EMPTY_CONTENT_USER_MESSAGE,
]);

export const RETRY_FAILED_MESSAGE =
  'Something broke on our end. Try again — if it keeps failing, email support@2anki.net.';

const isPdfLibraryError = (error: unknown): error is Error =>
  error instanceof Error && error.name.endsWith('Exception');

// The form shows what this route sends, and a plain Error or a provider's API
// error carries text written for logs: a tool's output or an upstream status.
// Anthropic SDK errors that carry no status: connection and abort errors, and
// the base APIError a stream raises for an error event mid-response.
const STATUSLESS_PROVIDER_ERRORS = new Set([
  'AnthropicError',
  'APIError',
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'APIUserAbortError',
  'RetryableError',
]);

const carriesRawText = (error: unknown): error is Error => {
  if (!(error instanceof Error) || error instanceof HttpCodedError) {
    return false;
  }
  if (WRITTEN_FOR_THE_PERSON.has(error.message)) return false;
  const isPlainError = error.constructor === Error;
  const isProviderError =
    typeof (error as { status?: unknown }).status === 'number' ||
    STATUSLESS_PROVIDER_ERRORS.has(error.constructor.name);
  return (
    (isPlainError || isProviderError) &&
    jobFailureReasonCode(error) === 'unknown'
  );
};

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
        throw new Error(NO_CARDS_MESSAGE);
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
        return {
          unreadable: LOCKED_PDF_UNREADABLE_REASON,
          code: 'password_protected_pdf',
        };
      }
      if (isUnreadablePdfError(error) || isPdfLibraryError(error)) {
        console.error('[retry-pdf] unreadable PDF', {
          kind: error.message.split(/[ :]/)[0],
          name: error.name,
        });
        return {
          unreadable: PDF_UNREADABLE_REASON,
          code: 'pdf_processing_failed',
        };
      }
      if (carriesRawText(error)) {
        console.error('[retry-pdf] conversion failed', error);
        throw new HttpCodedError(RETRY_FAILED_MESSAGE, 500, 'unknown');
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

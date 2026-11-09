import { vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  LOCKED_PDF_UNREADABLE_REASON,
  RETRY_FAILED_MESSAGE,
  RetryPdfWithCredentialUseCase,
} from './RetryPdfWithCredentialUseCase';
import { PDF_EXCEEDS_MAX_PAGE_LIMIT } from '../../infrastracture/adapters/fileConversion/convertPDFToImages';
import {
  EMPTY_CONTENT_USER_MESSAGE,
  LARGE_SECTION_USER_MESSAGE,
} from '../../lib/claude/ClaudeService';
import { PDF_UNREADABLE_REASON } from '../jobs/jobFailureReason';
import { buildPdfPasswordSentinel } from '../../lib/pdf/pdfPasswordSentinel';
import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import CardOption from '../../lib/parser/Settings';
import Workspace from '../../lib/parser/WorkSpace';
import { PythonExitError } from '../../lib/anki/buildPythonExitError';

vi.mock('../../infrastracture/adapters/fileConversion/PrepareDeck', () => ({
  PrepareDeck: vi.fn(),
}));

const mockPrepareDeck = vi.mocked(PrepareDeck);

describe('RetryPdfWithCredentialUseCase', () => {
  it('converts the PDF even when PDFs inside ZIPs are switched off', async () => {
    mockPrepareDeck.mockResolvedValueOnce({
      apkg: Buffer.from('apkg'),
      cardCount: 3,
      name: 'lecture.apkg',
    } as Awaited<ReturnType<typeof PrepareDeck>>);

    const result = await new RetryPdfWithCredentialUseCase().execute(
      Buffer.from('%PDF-1.4'),
      'lecture.pdf',
      'secret',
      true,
      new CardOption({ 'process-pdfs': 'false' }),
      { location: '/tmp/retry-test' } as Workspace
    );

    expect(mockPrepareDeck.mock.calls[0][0].settings.processPDFs).toBe(true);
    expect(result).toEqual({
      apkg: Buffer.from('apkg'),
      cardCount: 3,
      name: 'lecture.apkg',
    });
  });

  it.each([
    [
      'a locked-PDF error that reaches the route unconverted',
      'pdfinfo_password path=scan.pdf',
      LOCKED_PDF_UNREADABLE_REASON,
      'password_protected_pdf',
    ],
    [
      'a password too long for the page-image tools',
      'pdfinfo_password_too_long path=scan.pdf',
      LOCKED_PDF_UNREADABLE_REASON,
      'password_protected_pdf',
    ],
    [
      'a pdfinfo failure',
      'pdfinfo_failed code=1 signal=null path=a.pdf stderr=boom',
      PDF_UNREADABLE_REASON,
      'pdf_processing_failed',
    ],
    [
      'pdfinfo failing to start',
      'pdfinfo_spawn_failed: ENOENT /usr/bin/pdfinfo',
      PDF_UNREADABLE_REASON,
      'pdf_processing_failed',
    ],
  ])(
    'answers with readable copy for %s',
    async (_failure, raw, unreadable, code) => {
      mockPrepareDeck.mockRejectedValueOnce(new Error(raw));

      const result = await new RetryPdfWithCredentialUseCase().execute(
        Buffer.from('%PDF-1.4'),
        'scan.pdf',
        'secret',
        true,
        new CardOption({}),
        { location: '/tmp/retry-test' } as Workspace
      );

      expect(result).toEqual({ unreadable, code });
    }
  );

  const runFailure = (error: Error) => {
    mockPrepareDeck.mockRejectedValueOnce(error);
    return new RetryPdfWithCredentialUseCase().execute(
      Buffer.from('%PDF-1.4'),
      'scan.pdf',
      'secret',
      true,
      new CardOption({}),
      { location: '/tmp/retry-test' } as Workspace
    );
  };

  const named = (name: string, message: string) =>
    Object.assign(new (class extends Error {})(message), { name });

  it('keeps a password the page images refuse at the prompt as a wrong password', async () => {
    await expect(
      runFailure(new Error(buildPdfPasswordSentinel('scan.pdf')))
    ).resolves.toEqual({ needsCredential: true, reason: 'wrong_password' });
  });

  it('answers with readable copy for a pdf.js failure', async () => {
    await expect(
      runFailure(named('UnknownErrorException', 'pdf.js internals'))
    ).resolves.toEqual({
      unreadable: PDF_UNREADABLE_REASON,
      code: 'pdf_processing_failed',
    });
  });

  it.each([
    ['a plain tool failure', new Error('pdftoppm process exited with 1')],
    ['Claude text in a plain error', new Error('529 overloaded_error')],
    [
      'a provider API error',
      Object.assign(named('InternalServerError', '500 upstream'), {
        status: 500,
      }),
    ],
    [
      'a provider connection error with no status',
      new Anthropic.APIConnectionError({ message: 'Connection error.' }),
    ],
    [
      'a provider stream error with no status',
      new Anthropic.APIError(
        undefined,
        { type: 'error', error: { type: 'overloaded_error' } },
        'Overloaded',
        undefined
      ),
    ],
  ])('hides the raw text of %s', async (_failure, error) => {
    const failure = await runFailure(error).catch((thrown) => thrown);

    expect(failure).toMatchObject({
      message: RETRY_FAILED_MESSAGE,
      status: 500,
      code: 'unknown',
    });
  });

  it.each([
    ['the page limit', new Error(PDF_EXCEEDS_MAX_PAGE_LIMIT)],
    ['a large section from Claude', new Error(LARGE_SECTION_USER_MESSAGE)],
    ['empty content from Claude', new Error(EMPTY_CONTENT_USER_MESSAGE)],
    [
      'an error class with its own copy',
      named('ClaudeRefusalError', 'Declined'),
    ],
  ])('keeps the message of %s', async (_failure, error) => {
    await expect(runFailure(error)).rejects.toBe(error);
  });

  it('meters an anonymous pass holder by threading the pass id into PrepareDeck', async () => {
    mockPrepareDeck.mockResolvedValueOnce({
      apkg: Buffer.from('apkg'),
      cardCount: 1,
      name: 'lecture.apkg',
    } as Awaited<ReturnType<typeof PrepareDeck>>);

    await new RetryPdfWithCredentialUseCase().execute(
      Buffer.from('%PDF-1.4'),
      'lecture.pdf',
      'secret',
      true,
      new CardOption({}),
      { location: '/tmp/retry-test' } as Workspace,
      null,
      7
    );

    expect(mockPrepareDeck.mock.calls[0][0].userId).toBeNull();
    expect(mockPrepareDeck.mock.calls[0][0].anonymousPassId).toBe(7);
  });

  it.each([
    ['a signed-out visitor', false, null, null],
    ['a free user, before any limit check', false, 42, null],
    ['a paying user', true, 42, null],
    ['a signed-out pass holder', true, null, 7],
  ])(
    'rethrows a deck-writer crash for %s unchanged, so error capture receives it',
    async (_who, paying, userId, anonymousPassId) => {
      const crash = new PythonExitError('The deck writer stopped.', {
        kind: 'unknown',
        rawOutput: "KeyError: 'Front'",
        code: 1,
      });
      mockPrepareDeck.mockRejectedValueOnce(crash);
      const cardUsage = {
        getCardUsage: vi.fn(),
        incrementCardUsage: vi.fn(),
      };

      await expect(
        new RetryPdfWithCredentialUseCase(cardUsage).execute(
          Buffer.from('%PDF-1.4'),
          'lecture.pdf',
          'secret',
          paying,
          new CardOption({}),
          { location: '/tmp/retry-test' } as Workspace,
          userId,
          anonymousPassId
        )
      ).rejects.toBe(crash);
      expect(cardUsage.getCardUsage).not.toHaveBeenCalled();
    }
  );
});

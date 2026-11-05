import { vi } from 'vitest';
import { RetryPdfWithCredentialUseCase } from './RetryPdfWithCredentialUseCase';
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

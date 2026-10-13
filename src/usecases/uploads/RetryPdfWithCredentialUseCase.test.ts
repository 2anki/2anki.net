import { vi } from 'vitest';
import { RetryPdfWithCredentialUseCase } from './RetryPdfWithCredentialUseCase';
import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import CardOption from '../../lib/parser/Settings';
import Workspace from '../../lib/parser/WorkSpace';

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
});

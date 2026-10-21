import { describe, it, expect, vi } from 'vitest';
import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import { previewHoldKey } from '../../lib/upload/anonymousAiPreview';
import {
  AiPreviewHoldExpiredError,
  NoAiPreviewHoldError,
  ResumeAnonymousAiPreviewUseCase,
  type AiPreviewPassConverter,
  type HeldFileStore,
} from './ResumeAnonymousAiPreviewUseCase';

function seedPreviewHold(repo: InMemoryHeldDeckRepository, anonId: string) {
  return repo.insert({
    storageKey: 'held/abc',
    anonId: previewHoldKey(anonId),
    filename: 'notes.pdf',
    cardCount: 0,
    cardsHeldBack: 0,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function fakeStore(body: Buffer | undefined): HeldFileStore & {
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    getFileContents: vi.fn().mockResolvedValue({ Body: body }),
    delete: vi.fn().mockResolvedValue(true),
  };
}

function fakeConverter(): AiPreviewPassConverter & {
  convertStoredFileWithAiForPass: ReturnType<typeof vi.fn>;
} {
  return {
    convertStoredFileWithAiForPass: vi.fn().mockResolvedValue({
      apkg: Buffer.from('APKG'),
      cardCount: 42,
      deckName: 'notes',
    }),
  };
}

describe('ResumeAnonymousAiPreviewUseCase', () => {
  it('converts the stored file with AI metered against the pass, then consumes the hold', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'visitor-1');
    const store = fakeStore(Buffer.from('PDF BYTES'));
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(repo, store, converter);

    const result = await useCase.execute({
      anonymousPassId: 77,
      anonId: 'visitor-1',
      requestId: 'r9',
    });

    expect(result).toEqual({
      apkg: Buffer.from('APKG'),
      cardCount: 42,
      deckName: 'notes',
    });
    const [passId, file, requestId] =
      converter.convertStoredFileWithAiForPass.mock.calls[0];
    expect(passId).toBe(77);
    expect(file.buffer).toEqual(Buffer.from('PDF BYTES'));
    expect(file.originalname).toBe('notes.pdf');
    expect(requestId).toBe('r9');
    expect(store.delete).toHaveBeenCalledWith('held/abc');
    expect(repo.rows).toHaveLength(0);
  });

  it('throws when the visitor has no preview hold', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('x')),
      fakeConverter()
    );
    await expect(
      useCase.execute({ anonymousPassId: 1, anonId: 'nobody', requestId: 'r' })
    ).rejects.toBeInstanceOf(NoAiPreviewHoldError);
  });

  it('never reads a bare-anon-id sign-up hold as a preview hold', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await repo.insert({
      storageKey: 'held/signup',
      anonId: 'visitor-1',
      filename: 'deck.pdf',
      cardCount: 30,
      cardsHeldBack: 9,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('x')),
      converter
    );
    await expect(
      useCase.execute({
        anonymousPassId: 1,
        anonId: 'visitor-1',
        requestId: 'r',
      })
    ).rejects.toBeInstanceOf(NoAiPreviewHoldError);
    expect(converter.convertStoredFileWithAiForPass).not.toHaveBeenCalled();
  });

  it('throws expired and leaves the hold when the stored object is gone', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'visitor-1');
    const store = fakeStore(undefined);
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(repo, store, converter);

    await expect(
      useCase.execute({
        anonymousPassId: 5,
        anonId: 'visitor-1',
        requestId: 'r',
      })
    ).rejects.toBeInstanceOf(AiPreviewHoldExpiredError);
    expect(converter.convertStoredFileWithAiForPass).not.toHaveBeenCalled();
  });
});

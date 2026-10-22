import { describe, it, expect, vi } from 'vitest';
import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import { previewHoldKey } from '../../lib/upload/anonymousAiPreview';
import {
  AiPreviewHoldExpiredError,
  NoAiPreviewHoldError,
  ResumeAnonymousAiPreviewUseCase,
  type AiPreviewPassConverter,
  type CheckoutBindingReader,
  type CheckoutPreviewBinding,
  type HeldFileStore,
} from './ResumeAnonymousAiPreviewUseCase';

function seedPreviewHold(
  repo: InMemoryHeldDeckRepository,
  anonId: string,
  storageKey = 'held/abc',
  filename = 'notes.pdf'
) {
  return repo.insert({
    storageKey,
    anonId: previewHoldKey(anonId),
    filename,
    cardCount: 0,
    cardsHeldBack: 0,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function seedPass(
  passes: InMemoryAnonymousPassRepository,
  sessionId: string
) {
  const pass = await passes.insert({
    stripeSessionId: sessionId,
    kind: '24h',
    expiresAt: new Date(Date.now() + 60_000),
    paymentIntentId: `pi_${sessionId}`,
  });
  return pass.id;
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

// Maps each pass session id to the binding it was bought with, standing in for
// the Stripe-session-metadata lookup.
function bindingReader(
  bySession: Record<string, CheckoutPreviewBinding>
): CheckoutBindingReader {
  return async (sessionId: string) =>
    bySession[sessionId] ?? { anonId: null, surface: null };
}

const AI_PREVIEW: CheckoutPreviewBinding['surface'] = 'ai-preview';

describe('ResumeAnonymousAiPreviewUseCase', () => {
  it('converts the hold the pass was bought for, metered against the pass, then consumes it', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'visitor-1');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_buyer1');
    const store = fakeStore(Buffer.from('PDF BYTES'));
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      store,
      converter,
      passes,
      bindingReader({ cs_buyer1: { anonId: 'visitor-1', surface: AI_PREVIEW } })
    );

    const result = await useCase.execute({
      anonymousPassId: passId,
      anonId: 'visitor-1',
      requestId: 'r9',
    });

    expect(result).toEqual({
      apkg: Buffer.from('APKG'),
      cardCount: 42,
      deckName: 'notes',
    });
    const [billedPassId, file] =
      converter.convertStoredFileWithAiForPass.mock.calls[0];
    expect(billedPassId).toBe(passId);
    expect(file.buffer).toEqual(Buffer.from('PDF BYTES'));
    expect(store.delete).toHaveBeenCalledWith('held/abc');
    expect(repo.rows).toHaveLength(0);
  });

  it('refuses a pass not bought from the ai-preview surface', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'visitor-1');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_limitwall');
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('x')),
      converter,
      passes,
      bindingReader({
        cs_limitwall: { anonId: 'visitor-1', surface: 'anonymous-limit-wall' },
      })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: 'visitor-1',
        requestId: 'r',
      })
    ).rejects.toBeInstanceOf(NoAiPreviewHoldError);
    expect(converter.convertStoredFileWithAiForPass).not.toHaveBeenCalled();
    expect(repo.rows).toHaveLength(1);
  });

  it('never converts another visitor’s hold even when their anon_id is presented', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'victim', 'held/victim', 'secret.pdf');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_attacker');
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('x')),
      converter,
      passes,
      bindingReader({
        cs_attacker: { anonId: 'attacker', surface: AI_PREVIEW },
      })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: 'victim',
        requestId: 'r',
      })
    ).rejects.toBeInstanceOf(NoAiPreviewHoldError);
    expect(converter.convertStoredFileWithAiForPass).not.toHaveBeenCalled();
    expect(repo.rows).toHaveLength(1);
  });

  it('a pass bought for one visitor cannot reach a different visitor’s hold', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'buyer-a', 'held/a', 'a.pdf');
    await seedPreviewHold(repo, 'buyer-b', 'held/b', 'b.pdf');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_a');
    const store = fakeStore(Buffer.from('A BYTES'));
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      store,
      converter,
      passes,
      bindingReader({ cs_a: { anonId: 'buyer-a', surface: AI_PREVIEW } })
    );

    await useCase.execute({
      anonymousPassId: passId,
      anonId: 'buyer-a',
      requestId: 'r',
    });

    expect(
      converter.convertStoredFileWithAiForPass.mock.calls[0][1].buffer
    ).toEqual(Buffer.from('A BYTES'));
    expect(repo.rows.map((r) => r.storage_key)).toEqual(['held/b']);
  });

  it('cannot resume the same hold twice', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'visitor-1');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_buyer1');
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('bytes')),
      fakeConverter(),
      passes,
      bindingReader({ cs_buyer1: { anonId: 'visitor-1', surface: AI_PREVIEW } })
    );

    await useCase.execute({
      anonymousPassId: passId,
      anonId: 'visitor-1',
      requestId: 'r',
    });
    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: 'visitor-1',
        requestId: 'r',
      })
    ).rejects.toBeInstanceOf(NoAiPreviewHoldError);
  });

  it('bills the pass once when two resumes race, the loser gets nothing', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'visitor-1');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_buyer1');
    const converter = fakeConverter();
    // Hold the conversion open so the second resume runs while the first is
    // mid-flight (after it has claimed the hold).
    let release: () => void = () => {};
    converter.convertStoredFileWithAiForPass.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ apkg: Buffer.from('A'), cardCount: 1, deckName: 'n' });
        })
    );
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('bytes')),
      converter,
      passes,
      bindingReader({ cs_buyer1: { anonId: 'visitor-1', surface: AI_PREVIEW } })
    );

    const first = useCase.execute({
      anonymousPassId: passId,
      anonId: 'visitor-1',
      requestId: 'r1',
    });
    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: 'visitor-1',
        requestId: 'r2',
      })
    ).rejects.toBeInstanceOf(NoAiPreviewHoldError);
    release();
    await first;
    expect(converter.convertStoredFileWithAiForPass).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when conversion fails so the visitor can retry', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'visitor-1');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_buyer1');
    const converter = fakeConverter();
    converter.convertStoredFileWithAiForPass
      .mockRejectedValueOnce(new Error('claude blip'))
      .mockResolvedValueOnce({
        apkg: Buffer.from('OK'),
        cardCount: 3,
        deckName: 'n',
      });
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('bytes')),
      converter,
      passes,
      bindingReader({ cs_buyer1: { anonId: 'visitor-1', surface: AI_PREVIEW } })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: 'visitor-1',
        requestId: 'r',
      })
    ).rejects.toThrow('claude blip');
    // The hold was released, so a retry succeeds.
    const retry = await useCase.execute({
      anonymousPassId: passId,
      anonId: 'visitor-1',
      requestId: 'r',
    });
    expect(retry.cardCount).toBe(3);
  });

  it('gets nothing when the buyer anon id cannot be resolved from the pass', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedPreviewHold(repo, 'visitor-1');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_buyer1');
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('x')),
      converter,
      passes,
      bindingReader({})
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: 'visitor-1',
        requestId: 'r',
      })
    ).rejects.toBeInstanceOf(NoAiPreviewHoldError);
    expect(converter.convertStoredFileWithAiForPass).not.toHaveBeenCalled();
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
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_buyer1');
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      fakeStore(Buffer.from('x')),
      converter,
      passes,
      bindingReader({ cs_buyer1: { anonId: 'visitor-1', surface: AI_PREVIEW } })
    );
    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: 'visitor-1',
        requestId: 'r',
      })
    ).rejects.toBeInstanceOf(NoAiPreviewHoldError);
    expect(converter.convertStoredFileWithAiForPass).not.toHaveBeenCalled();
  });

  it('throws expired and releases the claim when the stored object is gone', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const hold = await seedPreviewHold(repo, 'visitor-1');
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_buyer1');
    const store = fakeStore(undefined);
    const converter = fakeConverter();
    const useCase = new ResumeAnonymousAiPreviewUseCase(
      repo,
      store,
      converter,
      passes,
      bindingReader({ cs_buyer1: { anonId: 'visitor-1', surface: AI_PREVIEW } })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: 'visitor-1',
        requestId: 'r',
      })
    ).rejects.toBeInstanceOf(AiPreviewHoldExpiredError);
    expect(converter.convertStoredFileWithAiForPass).not.toHaveBeenCalled();
    // Claim released: the row survives for the TTL sweep, not consumed.
    expect(repo.rows.find((r) => r.id === hold.id)?.claimed_at).toBeNull();
  });
});

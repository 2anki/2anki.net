import { describe, it, expect, vi } from 'vitest';
import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import { previewHoldKey } from '../../lib/upload/anonymousAiPreview';
import { EmptyDeckError } from '../jobs/EmptyDeckError';
import {
  HeldDeckExpiredError,
  NoHeldDeckError,
  planHoldKey,
  type HeldFileStore,
} from './ClaimHeldDeckUseCase';
import type {
  CheckoutBindingReader,
  CheckoutPreviewBinding,
} from './ResumeAnonymousAiPreviewUseCase';
import {
  ClaimHeldDeckWithPassUseCase,
  type HeldDeckPassConverter,
} from './ClaimHeldDeckWithPassUseCase';

const BUYER = 'anon-buyer-1';
const OTHER = 'anon-other-2';

async function seedHold(
  repo: InMemoryHeldDeckRepository,
  anonId: string,
  overrides: { expiresAt?: Date; storageKey?: string } = {}
) {
  return repo.insert({
    storageKey: overrides.storageKey ?? `held/${anonId}`,
    anonId,
    filename: 'notes.html',
    cardCount: 21,
    cardsHeldBack: 129,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
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

function fakeStore(body: Buffer | undefined = Buffer.from('<html></html>')) {
  const getFileContents = vi.fn().mockResolvedValue({ Body: body });
  const store: HeldFileStore = { getFileContents };
  return { store, getFileContents };
}

function fakeConverter() {
  const convertHeldFileForPass = vi.fn().mockResolvedValue({
    apkg: Buffer.from('APKG'),
    cardCount: 150,
    deckName: 'notes',
  });
  const converter: HeldDeckPassConverter = { convertHeldFileForPass };
  return { converter, convertHeldFileForPass };
}

function bindingReader(
  bySession: Record<string, CheckoutPreviewBinding>
): CheckoutBindingReader {
  return async (sessionId: string) =>
    bySession[sessionId] ?? { anonId: null, surface: null };
}

function boughtFromGate(anonId: string): CheckoutPreviewBinding {
  return { anonId, surface: 'anonymous-gate' };
}

describe('ClaimHeldDeckWithPassUseCase', () => {
  it('builds the full held deck for the pass and marks the hold claimed', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const hold = await seedHold(repo, BUYER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_gate');
    const { store } = fakeStore(Buffer.from('HTML BYTES'));
    const { converter, convertHeldFileForPass } = fakeConverter();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      store,
      converter,
      passes,
      bindingReader({ cs_gate: boughtFromGate(BUYER) })
    );

    const result = await useCase.execute({
      anonymousPassId: passId,
      anonId: BUYER,
      cardOptions: { 'basic-reversed': 'true' },
      requestId: 'r1',
    });

    expect(result).toEqual({
      apkg: Buffer.from('APKG'),
      cardCount: 150,
      deckName: 'notes',
    });
    const [billedPassId, file, cardOptions, requestId] =
      convertHeldFileForPass.mock.calls[0];
    expect(billedPassId).toBe(passId);
    expect(file.buffer).toEqual(Buffer.from('HTML BYTES'));
    expect(file.originalname).toBe('notes.html');
    expect(cardOptions).toEqual({ 'basic-reversed': 'true' });
    expect(requestId).toBe('r1');
    const stored = repo.rows.find((row) => row.id === hold.id);
    expect(stored?.claimed_at).toBeInstanceOf(Date);
    expect(stored?.claimed_by).toBeNull();
  });

  it.each([
    ['24h', 'cs_day'],
    ['7d', 'cs_week'],
    ['120d', 'cs_semester'],
  ] as const)(
    'releases the hold for a %s pass bought by the same visitor',
    async (kind, sessionId) => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, BUYER);
      const passes = new InMemoryAnonymousPassRepository();
      const pass = await passes.insert({
        stripeSessionId: sessionId,
        kind,
        expiresAt: new Date(Date.now() + 60_000),
        paymentIntentId: `pi_${sessionId}`,
      });
      const { converter, convertHeldFileForPass } = fakeConverter();
      const useCase = new ClaimHeldDeckWithPassUseCase(
        repo,
        fakeStore().store,
        converter,
        passes,
        bindingReader({ [sessionId]: { anonId: BUYER, surface: null } })
      );

      await useCase.execute({
        anonymousPassId: pass.id,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      });

      expect(convertHeldFileForPass).toHaveBeenCalledTimes(1);
    }
  );

  it("never releases another visitor's deck: the cookie must match the anon id the pass was bought under", async () => {
    const repo = new InMemoryHeldDeckRepository();
    const victimHold = await seedHold(repo, OTHER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_attacker');
    const { converter, convertHeldFileForPass } = fakeConverter();
    const { store, getFileContents } = fakeStore();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      store,
      converter,
      passes,
      bindingReader({ cs_attacker: boughtFromGate(BUYER) })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: OTHER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
    expect(getFileContents).not.toHaveBeenCalled();
    expect(
      repo.rows.find((row) => row.id === victimHold.id)?.claimed_at
    ).toBeNull();
  });

  it('refuses when the checkout session carries no anon id (Stripe unreadable)', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, BUYER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_unbound');
    const { converter, convertHeldFileForPass } = fakeConverter();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      fakeStore().store,
      converter,
      passes,
      bindingReader({})
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
  });

  it('leaves a pass bought from the AI preview to the AI resume', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, BUYER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_preview');
    const { converter, convertHeldFileForPass } = fakeConverter();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      fakeStore().store,
      converter,
      passes,
      bindingReader({ cs_preview: { anonId: BUYER, surface: 'ai-preview' } })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
  });

  it('refuses a pass id with no pass row', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, BUYER);
    const { converter, convertHeldFileForPass } = fakeConverter();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      fakeStore().store,
      converter,
      new InMemoryAnonymousPassRepository(),
      bindingReader({})
    );

    await expect(
      useCase.execute({
        anonymousPassId: 999,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
  });

  it.each([
    ['plan hold', planHoldKey('4242')],
    ['AI preview source', previewHoldKey(BUYER)],
  ])(
    'never reaches a %s through a crafted cookie',
    async (_label, reservedKey) => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, reservedKey);
      const passes = new InMemoryAnonymousPassRepository();
      const passId = await seedPass(passes, 'cs_crafted');
      const { converter, convertHeldFileForPass } = fakeConverter();
      const useCase = new ClaimHeldDeckWithPassUseCase(
        repo,
        fakeStore().store,
        converter,
        passes,
        bindingReader({ cs_crafted: boughtFromGate(reservedKey) })
      );

      await expect(
        useCase.execute({
          anonymousPassId: passId,
          anonId: reservedKey,
          cardOptions: {},
          requestId: undefined,
        })
      ).rejects.toBeInstanceOf(NoHeldDeckError);
      expect(convertHeldFileForPass).not.toHaveBeenCalled();
    }
  );

  it('throws NoHeldDeckError for a buyer with no held deck', async () => {
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_nohold');
    const { converter, convertHeldFileForPass } = fakeConverter();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      new InMemoryHeldDeckRepository(),
      fakeStore().store,
      converter,
      passes,
      bindingReader({ cs_nohold: boughtFromGate(BUYER) })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
  });

  it('answers a visitor with no hold without calling Stripe', async () => {
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_cheap');
    const readBinding = vi.fn();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      new InMemoryHeldDeckRepository(),
      fakeStore().store,
      fakeConverter().converter,
      passes,
      readBinding
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
    expect(readBinding).not.toHaveBeenCalled();
  });

  it('releases the deck once: a reused pass session gets nothing the second time', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, BUYER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_twice');
    const { converter, convertHeldFileForPass } = fakeConverter();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      fakeStore().store,
      converter,
      passes,
      bindingReader({ cs_twice: boughtFromGate(BUYER) })
    );
    const params = {
      anonymousPassId: passId,
      anonId: BUYER,
      cardOptions: {},
      requestId: undefined,
    };

    await useCase.execute(params);

    await expect(useCase.execute(params)).rejects.toBeInstanceOf(
      HeldDeckExpiredError
    );
    expect(convertHeldFileForPass).toHaveBeenCalledTimes(1);
  });

  it('converts once when two claims race for the same hold', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, BUYER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_race');
    const { converter, convertHeldFileForPass } = fakeConverter();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      fakeStore().store,
      converter,
      passes,
      bindingReader({ cs_race: boughtFromGate(BUYER) })
    );
    const params = {
      anonymousPassId: passId,
      anonId: BUYER,
      cardOptions: {},
      requestId: undefined,
    };

    const outcomes = await Promise.allSettled([
      useCase.execute(params),
      useCase.execute(params),
    ]);

    expect(outcomes.map((o) => o.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(convertHeldFileForPass).toHaveBeenCalledTimes(1);
  });

  it('throws HeldDeckExpiredError for a hold past its expiry', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, BUYER, { expiresAt: new Date(Date.now() - 1000) });
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_late');
    const { converter, convertHeldFileForPass } = fakeConverter();
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      fakeStore().store,
      converter,
      passes,
      bindingReader({ cs_late: boughtFromGate(BUYER) })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
  });

  it('releases the claim after a transient failure so the visitor can retry', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const hold = await seedHold(repo, BUYER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_flaky');
    const { converter, convertHeldFileForPass } = fakeConverter();
    convertHeldFileForPass.mockRejectedValueOnce(new Error('worker crashed'));
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      fakeStore().store,
      converter,
      passes,
      bindingReader({ cs_flaky: boughtFromGate(BUYER) })
    );
    const params = {
      anonymousPassId: passId,
      anonId: BUYER,
      cardOptions: {},
      requestId: undefined,
    };

    await expect(useCase.execute(params)).rejects.toThrow('worker crashed');
    expect(repo.rows.find((row) => row.id === hold.id)?.claimed_at).toBeNull();

    await expect(useCase.execute(params)).resolves.toMatchObject({
      cardCount: 150,
    });
  });

  it('consumes the hold when its file is gone from storage', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const hold = await seedHold(repo, BUYER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_gone');
    const { converter, convertHeldFileForPass } = fakeConverter();
    const missing = Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    const store: HeldFileStore = {
      getFileContents: vi.fn().mockRejectedValue(missing),
    };
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      store,
      converter,
      passes,
      bindingReader({ cs_gone: boughtFromGate(BUYER) })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
    expect(
      repo.rows.find((row) => row.id === hold.id)?.claimed_at
    ).toBeInstanceOf(Date);
  });

  it('consumes the hold when the rebuilt deck is empty', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const hold = await seedHold(repo, BUYER);
    const passes = new InMemoryAnonymousPassRepository();
    const passId = await seedPass(passes, 'cs_empty');
    const { converter, convertHeldFileForPass } = fakeConverter();
    convertHeldFileForPass.mockRejectedValueOnce(new EmptyDeckError());
    const useCase = new ClaimHeldDeckWithPassUseCase(
      repo,
      fakeStore().store,
      converter,
      passes,
      bindingReader({ cs_empty: boughtFromGate(BUYER) })
    );

    await expect(
      useCase.execute({
        anonymousPassId: passId,
        anonId: BUYER,
        cardOptions: {},
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(EmptyDeckError);
    expect(
      repo.rows.find((row) => row.id === hold.id)?.claimed_at
    ).toBeInstanceOf(Date);
  });
});

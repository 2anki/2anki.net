import { vi } from 'vitest';
import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import { EmptyDeckError } from '../jobs/EmptyDeckError';
import { MonthlyLimitError } from '../users/CheckMonthlyCardLimitUseCase';
import {
  ClaimHeldDeckUseCase,
  HeldDeckExpiredError,
  NoHeldDeckError,
  planHoldKey,
  type HeldDeckConversion,
  type HeldDeckConverter,
  type HeldFileStore,
} from './ClaimHeldDeckUseCase';

const ANON = 'anon-claim-1';
const OWNER = '4242';

function buildStore(body: Buffer | null = Buffer.from('<html></html>')) {
  const getFileContents = vi
    .fn()
    .mockResolvedValue({ Body: body ?? undefined });
  const store: HeldFileStore = { getFileContents };
  return { store, getFileContents };
}

function buildConverter(
  result: HeldDeckConversion = {
    downloadKey: 'owner-key.apkg',
    cardCount: 34,
    cardsHeldBack: 0,
    deckName: 'study-notes',
  }
) {
  const convertHeldFileForOwner = vi.fn().mockResolvedValue(result);
  const converter: HeldDeckConverter = { convertHeldFileForOwner };
  return { converter, convertHeldFileForOwner };
}

async function seedHold(
  repo: InMemoryHeldDeckRepository,
  overrides: { expiresAt?: Date; anonId?: string } = {}
) {
  return repo.insert({
    storageKey: 'held/abc.html',
    anonId: overrides.anonId ?? ANON,
    filename: 'study-notes.html',
    cardCount: 21,
    cardsHeldBack: 13,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
  });
}

describe('ClaimHeldDeckUseCase', () => {
  it('404s (NoHeldDeckError) when the visitor has no hold', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
  });

  it('404s when there is no anonymous id to bind the claim to', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: null,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
  });

  it('410s (HeldDeckExpiredError) when the only hold has expired', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, { expiresAt: new Date(Date.now() - 60_000) });
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
  });

  it('converts the held file as the claimant and stamps the claim on the first claim', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const { store, getFileContents } = buildStore();
    const { converter, convertHeldFileForOwner } = buildConverter();
    const useCase = new ClaimHeldDeckUseCase(repo, store, converter);

    const result = await useCase.execute({
      anonId: ANON,
      owner: OWNER,
      paying: false,
      requestId: 'req-1',
    });

    expect(result).toEqual({
      downloadKey: 'owner-key.apkg',
      cardCount: 34,
      deckName: 'study-notes',
      kind: 'signup',
    });
    expect(getFileContents).toHaveBeenCalledWith('held/abc.html');
    expect(convertHeldFileForOwner).toHaveBeenCalledTimes(1);
    const [owner, file, paying, source, requestId] =
      convertHeldFileForOwner.mock.calls[0];
    expect(owner).toBe(OWNER);
    expect(file).toMatchObject({ originalname: 'study-notes.html' });
    expect(paying).toBe(false);
    expect(source).toBeNull();
    expect(requestId).toBe('req-1');
    expect(repo.rows[0].claimed_at).not.toBeNull();
    expect(repo.rows[0].claimed_by).toBe(4242);
  });

  it('re-converts a held zip by handing the .zip source to the converter unchanged', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await repo.insert({
      storageKey: 'held/zip-source.bin',
      anonId: ANON,
      filename: 'study-notes.zip',
      cardCount: 21,
      cardsHeldBack: 13,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const zipBytes = Buffer.from('PK\x03\x04 zip bytes');
    const { store } = buildStore(zipBytes);
    const { converter, convertHeldFileForOwner } = buildConverter();
    const useCase = new ClaimHeldDeckUseCase(repo, store, converter);

    await useCase.execute({
      anonId: ANON,
      owner: OWNER,
      paying: false,
      requestId: undefined,
    });

    expect(convertHeldFileForOwner).toHaveBeenCalledTimes(1);
    const [, file] = convertHeldFileForOwner.mock.calls[0];
    expect(file).toMatchObject({ originalname: 'study-notes.zip' });
    expect(file.buffer).toEqual(zipBytes);
  });

  it('410s on a second claim once the hold is already claimed', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    await useCase.execute({
      anonId: ANON,
      owner: OWNER,
      paying: false,
      requestId: undefined,
    });

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
  });

  it('claims before converting and releases the claim when the conversion fails', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const markClaimed = vi.spyOn(repo, 'markClaimed');
    const convertHeldFileForOwner = vi
      .fn()
      .mockRejectedValue(new Error('parser crashed'));
    const useCase = new ClaimHeldDeckUseCase(repo, buildStore().store, {
      convertHeldFileForOwner,
    });

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toThrow('parser crashed');

    expect(markClaimed.mock.invocationCallOrder[0]).toBeLessThan(
      convertHeldFileForOwner.mock.invocationCallOrder[0]
    );
    expect(repo.rows[0].claimed_at).toBeNull();
    expect(repo.rows[0].claimed_by).toBeNull();
  });

  it('keeps the hold consumed when the account is over its monthly limit', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const convertHeldFileForOwner = vi
      .fn()
      .mockRejectedValue(new MonthlyLimitError(100, 100, 21, '2026-10-01'));
    const useCase = new ClaimHeldDeckUseCase(repo, buildStore().store, {
      convertHeldFileForOwner,
    });

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(MonthlyLimitError);

    expect(repo.rows[0].claimed_at).not.toBeNull();
    expect(await useCase.peek(ANON)).toBeNull();
  });

  it('410s when storage reports the object missing', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const missing = Object.assign(
      new Error('The specified key does not exist'),
      {
        name: 'NoSuchKey',
      }
    );
    const store: HeldFileStore = {
      getFileContents: vi.fn().mockRejectedValue(missing),
    };
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
    expect(repo.rows[0].claimed_at).not.toBeNull();
    expect(await useCase.peek(ANON)).toBeNull();
  });

  it('keeps the hold consumed when the held file makes no cards', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const convertHeldFileForOwner = vi
      .fn()
      .mockRejectedValue(new EmptyDeckError());
    const useCase = new ClaimHeldDeckUseCase(repo, buildStore().store, {
      convertHeldFileForOwner,
    });

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(EmptyDeckError);

    expect(repo.rows[0].claimed_at).not.toBeNull();
  });

  it('410s when the stored source object is already gone', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore(null).store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
  });

  it('peek returns the claimable hold counts, or null when none is claimable', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    expect(await useCase.peek(ANON)).toBeNull();
    await seedHold(repo);
    expect(await useCase.peek(ANON)).toEqual({
      cardCount: 21,
      cardsHeldBack: 13,
    });
    expect(await useCase.peek(null)).toBeNull();
  });

  describe('plan holds', () => {
    it('hides a plan hold until the owner pays', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, { anonId: planHoldKey(OWNER) });
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        buildConverter().converter
      );

      expect(await useCase.peek(null, OWNER, false)).toBeNull();
      expect(await useCase.peek(null, OWNER, true)).toEqual({
        cardCount: 21,
        cardsHeldBack: 13,
      });
    });

    it('refuses to claim a plan hold for an owner who has not paid, leaving it in place', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, { anonId: planHoldKey(OWNER) });
      const { converter, convertHeldFileForOwner } = buildConverter();
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter
      );

      await expect(
        useCase.execute({
          anonId: ANON,
          owner: OWNER,
          paying: false,
          requestId: undefined,
        })
      ).rejects.toBeInstanceOf(NoHeldDeckError);

      expect(convertHeldFileForOwner).not.toHaveBeenCalled();
      expect(repo.rows[0].claimed_at).toBeNull();
    });

    it('builds the full deck as a paying owner once they have a plan', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, { anonId: planHoldKey(OWNER) });
      const { converter, convertHeldFileForOwner } = buildConverter();
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter
      );

      const result = await useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: true,
        requestId: 'req-1',
      });

      expect(result).toEqual({
        downloadKey: 'owner-key.apkg',
        cardCount: 34,
        deckName: 'study-notes',
        kind: 'plan',
      });
      expect(convertHeldFileForOwner).toHaveBeenCalledWith(
        OWNER,
        expect.objectContaining({ originalname: 'study-notes.html' }),
        true,
        null,
        'req-1'
      );
      expect(repo.rows[0].claimed_by).toBe(Number(OWNER));
    });

    it("claims another owner's plan hold never", async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, { anonId: planHoldKey('9999') });
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        buildConverter().converter
      );

      await expect(
        useCase.execute({
          anonId: ANON,
          owner: OWNER,
          paying: true,
          requestId: undefined,
        })
      ).rejects.toBeInstanceOf(NoHeldDeckError);
    });

    it.each([true, false])(
      'never lets an anon_id cookie forged as a plan key reach that plan hold (paying: %s)',
      async (paying) => {
        const repo = new InMemoryHeldDeckRepository();
        await seedHold(repo, { anonId: planHoldKey('9999') });
        const { converter, convertHeldFileForOwner } = buildConverter();
        const useCase = new ClaimHeldDeckUseCase(
          repo,
          buildStore().store,
          converter
        );

        expect(
          await useCase.peek(planHoldKey('9999'), OWNER, paying)
        ).toBeNull();
        await expect(
          useCase.execute({
            anonId: planHoldKey('9999'),
            owner: OWNER,
            paying,
            requestId: undefined,
          })
        ).rejects.toBeInstanceOf(NoHeldDeckError);
        expect(convertHeldFileForOwner).not.toHaveBeenCalled();
        expect(repo.rows[0].claimed_at).toBeNull();
      }
    );

    it('prefers the signup hold from this browser over a plan hold', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, { anonId: planHoldKey(OWNER) });
      await seedHold(repo);
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        buildConverter().converter
      );

      const result = await useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: true,
        requestId: undefined,
      });

      expect(result.kind).toBe('signup');
      expect(
        repo.rows.find((r) => r.anon_id === ANON)?.claimed_at
      ).not.toBeNull();
      expect(
        repo.rows.find((r) => r.anon_id === planHoldKey(OWNER))?.claimed_at
      ).toBeNull();
    });
  });
});

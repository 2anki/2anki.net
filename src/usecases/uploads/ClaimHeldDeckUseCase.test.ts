import { vi } from 'vitest';
import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import { EmptyDeckError } from '../jobs/EmptyDeckError';
import { MonthlyLimitError } from '../users/CheckMonthlyCardLimitUseCase';
import {
  ClaimHeldDeckUseCase,
  HeldDeckExpiredError,
  MAX_PLAN_HOLDS,
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

  it('never claims a preview-namespace hold via a crafted preview: cookie', async () => {
    const repo = new InMemoryHeldDeckRepository();
    // A victim's AI-preview source, stored under the reserved preview: prefix.
    await seedHold(repo, { anonId: 'preview:victim' });
    const { converter, convertHeldFileForOwner } = buildConverter();
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      converter
    );

    await expect(
      useCase.execute({
        anonId: 'preview:victim',
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
    expect(convertHeldFileForOwner).not.toHaveBeenCalled();
  });

  it('never peeks a preview-namespace hold via a crafted preview: cookie', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, { anonId: 'preview:victim' });
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    expect(await useCase.peek('preview:victim', OWNER, false)).toBeNull();
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

  it.each([
    {
      kind: 'zip',
      extension: '.zip',
      filename: 'study-notes.zip',
      bytes: Buffer.from('PK\x03\x04 zip bytes'),
    },
    {
      kind: 'PowerPoint',
      extension: '.pptx',
      filename: 'lecture.pptx',
      bytes: Buffer.from('PK\x03\x04 slide deck bytes'),
    },
  ])(
    're-converts a held $kind by handing the $extension source to the converter unchanged',
    async ({ filename, bytes }) => {
      const repo = new InMemoryHeldDeckRepository();
      await repo.insert({
        storageKey: 'held/source.bin',
        anonId: ANON,
        filename,
        cardCount: 21,
        cardsHeldBack: 13,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const { store } = buildStore(bytes);
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
      expect(file).toMatchObject({ originalname: filename });
      expect(file.buffer).toEqual(bytes);
    }
  );

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
    async function seedPlanHolds(
      repo: InMemoryHeldDeckRepository,
      count: number
    ) {
      for (let i = 0; i < count; i += 1) {
        await repo.insert({
          storageKey: `held/plan-${i}.html`,
          anonId: planHoldKey(OWNER),
          filename: `deck-${i}.html`,
          cardCount: 10,
          cardsHeldBack: 5,
          expiresAt: new Date(Date.now() + 60_000),
          cardOptions: { deckName: `Deck ${i}` },
        });
      }
    }

    function claimAsPayingOwner(useCase: ClaimHeldDeckUseCase) {
      return useCase.execute({
        anonId: null,
        owner: OWNER,
        paying: true,
        requestId: 'req-1',
      });
    }

    it('builds every waiting plan hold, each with its own options', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHolds(repo, 3);
      const { converter, convertHeldFileForOwner } = buildConverter();
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter
      );

      const result = await claimAsPayingOwner(useCase);

      expect(result).toMatchObject({ kind: 'plan', alsoClaimed: 2 });
      expect(repo.rows.every((row) => row.claimed_at != null)).toBe(true);
      expect(
        convertHeldFileForOwner.mock.calls.map((call) => call[5]).sort()
      ).toEqual([
        { deckName: 'Deck 0' },
        { deckName: 'Deck 1' },
        { deckName: 'Deck 2' },
      ]);
    });

    it('reports no extra decks when only one plan hold waits', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHolds(repo, 1);
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        buildConverter().converter
      );

      const result = await claimAsPayingOwner(useCase);

      expect(result).not.toHaveProperty('alsoClaimed');
    });

    it('builds the newest five plan holds and leaves older ones for the next claim', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHolds(repo, MAX_PLAN_HOLDS + 2);
      repo.rows.forEach((row, i) => {
        row.created_at = new Date(Date.UTC(2026, 10, 1, 0, i));
      });
      const { converter, convertHeldFileForOwner } = buildConverter();
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter
      );

      const result = await claimAsPayingOwner(useCase);

      expect(convertHeldFileForOwner).toHaveBeenCalledTimes(MAX_PLAN_HOLDS);
      expect(result.alsoClaimed).toBe(MAX_PLAN_HOLDS - 1);
      expect(convertHeldFileForOwner.mock.calls.map((call) => call[5])).toEqual(
        [
          { deckName: 'Deck 6' },
          { deckName: 'Deck 5' },
          { deckName: 'Deck 4' },
          { deckName: 'Deck 3' },
          { deckName: 'Deck 2' },
        ]
      );
      expect(
        repo.rows
          .filter((row) => row.claimed_at == null)
          .map((row) => row.filename)
      ).toEqual(['deck-0.html', 'deck-1.html']);
    });

    it('returns the newest deck when listing the other plan holds fails', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHolds(repo, 3);
      vi.spyOn(repo, 'findClaimable').mockRejectedValueOnce(
        new Error('connection reset')
      );
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        buildConverter().converter
      );

      const result = await claimAsPayingOwner(useCase);

      expect(result).toMatchObject({
        downloadKey: 'owner-key.apkg',
        kind: 'plan',
      });
      expect(result).not.toHaveProperty('alsoClaimed');
    });

    it('keeps the decks already built when marking another plan hold fails', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHolds(repo, 3);
      const markClaimed = repo.markClaimed.bind(repo);
      vi.spyOn(repo, 'markClaimed')
        .mockImplementationOnce(markClaimed)
        .mockImplementationOnce(markClaimed)
        .mockRejectedValueOnce(new Error('connection reset'));
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        buildConverter().converter
      );

      const result = await claimAsPayingOwner(useCase);

      expect(result).toMatchObject({
        downloadKey: 'owner-key.apkg',
        alsoClaimed: 1,
      });
    });

    it('returns the newest deck when releasing a failed plan hold also fails', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHolds(repo, 2);
      vi.spyOn(repo, 'releaseClaim').mockRejectedValueOnce(
        new Error('connection reset')
      );
      const { converter, convertHeldFileForOwner } = buildConverter();
      convertHeldFileForOwner
        .mockResolvedValueOnce({
          downloadKey: 'owner-key.apkg',
          cardCount: 34,
          cardsHeldBack: 0,
          deckName: 'study-notes',
        })
        .mockRejectedValueOnce(new Error('storage busy'));
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter
      );

      const result = await claimAsPayingOwner(useCase);

      expect(result).toMatchObject({ downloadKey: 'owner-key.apkg' });
    });

    it('keeps the first deck and leaves a transient failure claimable', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHolds(repo, 2);
      const { converter, convertHeldFileForOwner } = buildConverter();
      convertHeldFileForOwner
        .mockResolvedValueOnce({
          downloadKey: 'owner-key.apkg',
          cardCount: 34,
          cardsHeldBack: 0,
          deckName: 'study-notes',
        })
        .mockRejectedValueOnce(new Error('storage busy'));
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter
      );

      const result = await claimAsPayingOwner(useCase);

      expect(result).toMatchObject({ downloadKey: 'owner-key.apkg' });
      expect(result).not.toHaveProperty('alsoClaimed');
      expect(repo.rows.filter((row) => row.claimed_at == null)).toHaveLength(1);
    });

    it('consumes another plan hold the parser refuses, without failing the claim', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHolds(repo, 2);
      const { converter, convertHeldFileForOwner } = buildConverter();
      convertHeldFileForOwner
        .mockResolvedValueOnce({
          downloadKey: 'owner-key.apkg',
          cardCount: 34,
          cardsHeldBack: 0,
          deckName: 'study-notes',
        })
        .mockRejectedValueOnce(new EmptyDeckError());
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter
      );

      const result = await claimAsPayingOwner(useCase);

      expect(result).toMatchObject({ downloadKey: 'owner-key.apkg' });
      expect(repo.rows.every((row) => row.claimed_at != null)).toBe(true);
    });

    it('leaves plan holds alone when the claim releases a sign-up hold', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo);
      await seedPlanHolds(repo, 2);
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

      expect(result.kind).toBe('signup');
      expect(convertHeldFileForOwner).toHaveBeenCalledTimes(1);
      expect(
        repo.rows.filter(
          (row) => row.anon_id === planHoldKey(OWNER) && row.claimed_at == null
        )
      ).toHaveLength(2);
    });

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
        'req-1',
        null
      );
      expect(repo.rows[0].claimed_by).toBe(Number(OWNER));
    });

    it('rebuilds the deck with the card options saved on the hold', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await repo.insert({
        storageKey: 'held/abc.html',
        anonId: planHoldKey(OWNER),
        filename: 'study-notes.html',
        cardCount: 10,
        cardsHeldBack: 110,
        expiresAt: new Date(Date.now() + 60_000),
        cardOptions: { deckName: 'Biology', 'global-tags': 'cells' },
      });
      const { converter, convertHeldFileForOwner } = buildConverter();
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter
      );

      await useCase.execute({
        anonId: null,
        owner: OWNER,
        paying: true,
        requestId: 'req-1',
      });

      expect(convertHeldFileForOwner.mock.calls[0][5]).toEqual({
        deckName: 'Biology',
        'global-tags': 'cells',
      });
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

  describe('pass-first limit wall', () => {
    const passFirstOn = async () => true;
    const passFirstOff = async () => false;

    it('caps a free sign-up claim at the 21-card preview when the flag is on', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo);
      const { converter, convertHeldFileForOwner } = buildConverter({
        downloadKey: 'owner-key.apkg',
        cardCount: 21,
        cardsHeldBack: 163,
        deckName: 'study-notes',
        heldForPlan: true,
      });
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter,
        passFirstOn
      );

      const result = await useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      });

      expect(convertHeldFileForOwner.mock.calls[0][6]).toEqual({
        previewCap: 21,
        heldCards: 34,
      });
      expect(result).toEqual({
        downloadKey: 'owner-key.apkg',
        cardCount: 21,
        deckName: 'study-notes',
        kind: 'signup',
        cardsHeldBack: 163,
        heldForPlan: true,
      });
    });

    it('builds the full deck for a plan claim when the flag is on', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, { anonId: planHoldKey(OWNER) });
      const { converter, convertHeldFileForOwner } = buildConverter();
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter,
        passFirstOn
      );

      const result = await useCase.execute({
        anonId: null,
        owner: OWNER,
        paying: true,
        requestId: undefined,
      });

      expect(result.kind).toBe('plan');
      const call = convertHeldFileForOwner.mock.calls[0];
      expect(call[2]).toBe(true);
      expect(call[6]).toBeUndefined();
    });

    it('builds the full deck when a paying account claims a sign-up hold', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo);
      const { converter, convertHeldFileForOwner } = buildConverter();
      const useCase = new ClaimHeldDeckUseCase(
        repo,
        buildStore().store,
        converter,
        passFirstOn
      );

      await useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: true,
        requestId: undefined,
      });

      expect(convertHeldFileForOwner.mock.calls[0][6]).toBeUndefined();
    });

    it.each([
      ['the flag is off', passFirstOff],
      ['the flag read fails', () => Promise.reject(new Error('db down'))],
    ])(
      'keeps the up-to-100-card sign-up claim when %s',
      async (_label, passFirst) => {
        const repo = new InMemoryHeldDeckRepository();
        await seedHold(repo);
        const { converter, convertHeldFileForOwner } = buildConverter();
        const useCase = new ClaimHeldDeckUseCase(
          repo,
          buildStore().store,
          converter,
          passFirst
        );

        const result = await useCase.execute({
          anonId: ANON,
          owner: OWNER,
          paying: false,
          requestId: undefined,
        });

        expect(convertHeldFileForOwner.mock.calls[0]).toHaveLength(6);
        expect(result).toEqual({
          downloadKey: 'owner-key.apkg',
          cardCount: 34,
          deckName: 'study-notes',
          kind: 'signup',
        });
      }
    );
  });
});

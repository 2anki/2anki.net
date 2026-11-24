import knex from 'knex';
import { vi } from 'vitest';

import {
  InMemoryHeldDeckRepository,
  type HeldDeckPassFirstArm,
} from '../../data_layer/HeldDeckRepository';
import { resolvePassFirstArm } from '../../lib/upload/passFirstArm';
import {
  checkoutPassFirstArmFromHolds,
  ResolveCheckoutPassFirstArmUseCase,
} from './ResolveCheckoutPassFirstArmUseCase';

const PASS_FIRST_ANON = 'fresh-anon';
const CONTROL_ANON = 'golden-anon';

const testOn = () => Promise.resolve(true);

async function holdFor(
  repo: InMemoryHeldDeckRepository,
  anonId: string,
  passFirstArm?: HeldDeckPassFirstArm
) {
  return repo.insert({
    storageKey: 'held/abc',
    anonId,
    filename: 'notes.html',
    cardCount: 21,
    cardsHeldBack: 13,
    expiresAt: new Date(Date.now() + 60_000),
    passFirstArm,
  });
}

describe('ResolveCheckoutPassFirstArmUseCase', () => {
  it('uses one anon id from each arm', () => {
    expect(resolvePassFirstArm(PASS_FIRST_ANON, true)).toBe('pass_first');
    expect(resolvePassFirstArm(CONTROL_ANON, true)).toBe('control');
  });

  it.each([
    ['anonymous-gate', 'pass_first', CONTROL_ANON],
    ['held-preview', 'pass_first', CONTROL_ANON],
    ['anonymous-gate', 'control', PASS_FIRST_ANON],
  ] as const)(
    'tags a checkout from %s with the %s arm stored on the hold, not the hashed one',
    async (surface, storedArm, anonId) => {
      const repo = new InMemoryHeldDeckRepository();
      await holdFor(repo, anonId, storedArm);

      await expect(
        new ResolveCheckoutPassFirstArmUseCase(repo, testOn).execute(
          surface,
          anonId
        )
      ).resolves.toBe(storedArm);
    }
  );

  it('reads the arm of a hold the visitor already claimed', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const hold = await holdFor(repo, CONTROL_ANON, 'pass_first');
    await repo.markClaimed(hold.id, 42, new Date());

    await expect(
      new ResolveCheckoutPassFirstArmUseCase(repo, testOn).execute(
        'held-preview',
        CONTROL_ANON
      )
    ).resolves.toBe('pass_first');
  });

  it('tags nothing for a deck held before the flag went on', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await holdFor(repo, PASS_FIRST_ANON);

    await expect(
      new ResolveCheckoutPassFirstArmUseCase(repo, testOn).execute(
        'anonymous-gate',
        PASS_FIRST_ANON
      )
    ).resolves.toBe('off');
  });

  it.each([
    ['pass_first', PASS_FIRST_ANON],
    ['control', CONTROL_ANON],
  ])(
    'falls back to the hashed %s arm when the visitor has no hold',
    async (arm, anonId) => {
      await expect(
        new ResolveCheckoutPassFirstArmUseCase(
          new InMemoryHeldDeckRepository(),
          testOn
        ).execute('anonymous-gate', anonId)
      ).resolves.toBe(arm);
    }
  );

  it.each([
    ['no anon id', null],
    ['an empty anon id', ''],
  ])('puts a held-deck checkout with %s in control', async (_label, anonId) => {
    await expect(
      new ResolveCheckoutPassFirstArmUseCase(
        new InMemoryHeldDeckRepository(),
        testOn
      ).execute('anonymous-gate', anonId)
    ).resolves.toBe('control');
  });

  it.each(['plan:42', 'preview:fresh-anon'])(
    'never reads a hold under the reserved key %s from a crafted cookie',
    async (anonId) => {
      const repo = new InMemoryHeldDeckRepository();
      await holdFor(repo, anonId, 'pass_first');
      const findNewestByAnonId = vi.spyOn(repo, 'findNewestByAnonId');

      await expect(
        new ResolveCheckoutPassFirstArmUseCase(repo, testOn).execute(
          'anonymous-gate',
          anonId
        )
      ).resolves.toBe(resolvePassFirstArm(anonId, true));
      expect(findNewestByAnonId).not.toHaveBeenCalled();
    }
  );

  it.each([['upload-limit-wall'], ['limit'], [undefined]])(
    'leaves a checkout from %s untagged and reads neither the flag nor a hold',
    async (surface) => {
      const repo = new InMemoryHeldDeckRepository();
      await holdFor(repo, PASS_FIRST_ANON, 'pass_first');
      const findNewestByAnonId = vi.spyOn(repo, 'findNewestByAnonId');
      const testLive = vi.fn().mockResolvedValue(true);

      await expect(
        new ResolveCheckoutPassFirstArmUseCase(repo, testLive).execute(
          surface,
          PASS_FIRST_ANON
        )
      ).resolves.toBe('off');
      expect(testLive).not.toHaveBeenCalled();
      expect(findNewestByAnonId).not.toHaveBeenCalled();
    }
  );

  it('leaves a held-deck checkout untagged while the flag is off, even for a stored pass-first hold', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await holdFor(repo, PASS_FIRST_ANON, 'pass_first');

    await expect(
      new ResolveCheckoutPassFirstArmUseCase(repo, () =>
        Promise.resolve(false)
      ).execute('anonymous-gate', PASS_FIRST_ANON)
    ).resolves.toBe('off');
  });

  it('builds the checkout resolver over the held decks table', async () => {
    const pg = knex({ client: 'pg' });

    const resolver = checkoutPassFirstArmFromHolds(pg);

    expect(resolver).toBeInstanceOf(ResolveCheckoutPassFirstArmUseCase);
    await expect(resolver.execute('limit', PASS_FIRST_ANON)).resolves.toBe(
      'off'
    );
    await pg.destroy();
  });

  it('leaves the checkout untagged when the hold lookup fails', async () => {
    const repo = new InMemoryHeldDeckRepository();
    vi.spyOn(repo, 'findNewestByAnonId').mockRejectedValue(
      new Error('connection reset')
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      new ResolveCheckoutPassFirstArmUseCase(repo, testOn).execute(
        'anonymous-gate',
        PASS_FIRST_ANON
      )
    ).resolves.toBe('off');
  });
});

import { createHash } from 'node:crypto';

import {
  checkoutPassFirstArm,
  isPassFirstTestArm,
  isPassFirstTestLive,
  passFirstArmFor,
  passFirstArmProps,
  resolvePassFirstArm,
} from './passFirstArm';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../featureFlags/getFeatureFlag';
import { LIMIT_WALL_PASS_FIRST_FLAG } from '../featureFlags/limitWallPassFirst';

function flags(values: Record<string, boolean>, fails = false) {
  __setFeatureFlagDependencies({
    repository: {
      getAll: () => Promise.resolve([]),
      get: (key: string) =>
        fails
          ? Promise.reject(new Error('db down'))
          : Promise.resolve(values[key] ?? null),
      set: () => Promise.resolve(null),
    },
  });
}

function previewCardsArm(anonId: string): 'control' | 'treatment' {
  const digest = createHash('sha256')
    .update(`preview-cards:${anonId}`)
    .digest();
  return digest[0] % 2 === 0 ? 'treatment' : 'control';
}

function idInArm(arm: 'control' | 'pass_first'): string {
  for (let i = 0; i < 100; i++) {
    const anonId = `anon-${i}`;
    if (resolvePassFirstArm(anonId, true) === arm) return anonId;
  }
  throw new Error(`no id in ${arm}`);
}

describe('resolvePassFirstArm', () => {
  it('puts every visitor outside the test while the flag is off', () => {
    expect(resolvePassFirstArm('golden-anon', false)).toBe('off');
    expect(resolvePassFirstArm(null, false)).toBe('off');
  });

  it('puts a visitor with no anon id in control', () => {
    expect(resolvePassFirstArm(null, true)).toBe('control');
    expect(resolvePassFirstArm('', true)).toBe('control');
  });

  it('keeps a visitor in the same arm on every request', () => {
    const first = resolvePassFirstArm('anon-stable', true);
    for (let i = 0; i < 5; i++) {
      expect(resolvePassFirstArm('anon-stable', true)).toBe(first);
    }
  });

  it('picks the arm from the salted sha256 of the anon id', () => {
    for (let i = 0; i < 50; i++) {
      const anonId = `anon-${i}`;
      const digest = createHash('sha256')
        .update(`pass-first:${anonId}`)
        .digest();
      expect(resolvePassFirstArm(anonId, true)).toBe(
        digest[0] % 2 === 0 ? 'pass_first' : 'control'
      );
    }
  });

  it('splits visitors close to half and half', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `visitor-${i}`);
    const passFirst = ids.filter(
      (id) => resolvePassFirstArm(id, true) === 'pass_first'
    ).length;
    expect(passFirst).toBeGreaterThan(900);
    expect(passFirst).toBeLessThan(1100);
  });

  it('does not line up with the ended preview cards split', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `visitor-${i}`);
    const agree = ids.filter(
      (id) =>
        (resolvePassFirstArm(id, true) === 'pass_first') ===
        (previewCardsArm(id) === 'treatment')
    ).length;
    expect(agree).toBeGreaterThan(900);
    expect(agree).toBeLessThan(1100);
  });
});

describe('isPassFirstTestLive', () => {
  afterEach(() => __resetFeatureFlagModuleForTests());

  it('reads the limit_wall_pass_first flag', async () => {
    flags({ [LIMIT_WALL_PASS_FIRST_FLAG]: true });
    await expect(isPassFirstTestLive()).resolves.toBe(true);
  });

  it('is off while the flag is unset', async () => {
    flags({});
    await expect(isPassFirstTestLive()).resolves.toBe(false);
  });

  it('is off when the flag cannot be read', async () => {
    flags({}, true);
    await expect(isPassFirstTestLive()).resolves.toBe(false);
  });
});

describe('passFirstArmFor', () => {
  afterEach(() => __resetFeatureFlagModuleForTests());

  it('assigns no arm while the flag is off', async () => {
    flags({});
    await expect(passFirstArmFor(idInArm('pass_first'))).resolves.toBe('off');
  });

  it('assigns the hashed arm while the flag is on', async () => {
    flags({ [LIMIT_WALL_PASS_FIRST_FLAG]: true });
    await expect(passFirstArmFor(idInArm('pass_first'))).resolves.toBe(
      'pass_first'
    );
    await expect(passFirstArmFor(idInArm('control'))).resolves.toBe('control');
  });
});

describe('checkoutPassFirstArm', () => {
  afterEach(() => __resetFeatureFlagModuleForTests());

  it.each(['anonymous-gate', 'held-preview'])(
    'tags a checkout from %s with the visitor arm while the test runs',
    async (surface) => {
      flags({ [LIMIT_WALL_PASS_FIRST_FLAG]: true });
      await expect(
        checkoutPassFirstArm(surface, idInArm('pass_first'))
      ).resolves.toBe('pass_first');
    }
  );

  it.each([['upload-limit-wall'], ['limit'], [undefined]])(
    'leaves a checkout from %s untagged and reads no flag',
    async (surface) => {
      const get = vi.fn().mockResolvedValue(true);
      __setFeatureFlagDependencies({
        repository: {
          getAll: () => Promise.resolve([]),
          get,
          set: () => Promise.resolve(null),
        },
      });
      await expect(
        checkoutPassFirstArm(surface, idInArm('pass_first'))
      ).resolves.toBe('off');
      expect(get).not.toHaveBeenCalled();
    }
  );

  it('leaves a held-deck checkout untagged while the flag is off', async () => {
    flags({});
    await expect(
      checkoutPassFirstArm('anonymous-gate', idInArm('pass_first'))
    ).resolves.toBe('off');
  });
});

describe('passFirstArmProps', () => {
  it('adds nothing outside the test', () => {
    expect(passFirstArmProps('off')).toEqual({});
  });

  it.each(['control', 'pass_first'] as const)('names the %s arm', (arm) => {
    expect(passFirstArmProps(arm)).toEqual({ pass_first_arm: arm });
  });
});

describe('isPassFirstTestArm', () => {
  it.each([
    ['control', true],
    ['pass_first', true],
    ['off', false],
    ['treatment', false],
    [undefined, false],
  ])('reads %s as an arm: %s', (value, expected) => {
    expect(isPassFirstTestArm(value)).toBe(expected);
  });
});

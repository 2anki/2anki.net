import { createHash } from 'node:crypto';

import { getFeatureFlag } from '../featureFlags/getFeatureFlag';
import { LIMIT_WALL_PASS_FIRST_FLAG } from '../featureFlags/limitWallPassFirst';

export type PassFirstTestArm = 'control' | 'pass_first';
export type PassFirstArm = 'off' | PassFirstTestArm;

export async function isPassFirstTestLive(): Promise<boolean> {
  try {
    return await getFeatureFlag(LIMIT_WALL_PASS_FIRST_FLAG, false);
  } catch (error) {
    console.error('[passFirstArm] flag read failed', error);
    return false;
  }
}

// The salt keeps this split independent of the ended preview cards split.
export function resolvePassFirstArm(
  anonId: string | null,
  testLive: boolean
): PassFirstArm {
  if (!testLive) {
    return 'off';
  }
  if (anonId == null || anonId === '') {
    return 'control';
  }
  const digest = createHash('sha256').update(`pass-first:${anonId}`).digest();
  return digest[0] % 2 === 0 ? 'pass_first' : 'control';
}

export async function passFirstArmFor(
  anonId: string | null
): Promise<PassFirstArm> {
  return resolvePassFirstArm(anonId, await isPassFirstTestLive());
}

export function isPassFirstTestArm(value: unknown): value is PassFirstTestArm {
  return value === 'control' || value === 'pass_first';
}

export function passFirstArmProps(arm: PassFirstArm): {
  pass_first_arm?: PassFirstTestArm;
} {
  return arm === 'off' ? {} : { pass_first_arm: arm };
}

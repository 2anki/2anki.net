import type { Knex } from 'knex';

import HeldDeckRepository, {
  type IHeldDeckRepository,
} from '../../data_layer/HeldDeckRepository';
import { isPreviewHoldKey } from '../../lib/upload/anonymousAiPreview';
import {
  isPassFirstTestArm,
  isPassFirstTestLive,
  resolvePassFirstArm,
  type PassFirstArm,
} from '../../lib/upload/passFirstArm';
import { isPlanHoldKey } from '../uploads/ClaimHeldDeckUseCase';

const HELD_DECK_SURFACES = new Set(['anonymous-gate', 'held-preview']);

// A checkout from the held-deck gate carries the arm that visitor's newest
// hold was shown, claimed or not, so gate, claim and purchase name one arm.
// Only a visitor with no hold falls back to the arm their anon id hashes to.
export class ResolveCheckoutPassFirstArmUseCase {
  constructor(
    private readonly holds: Pick<IHeldDeckRepository, 'findNewestByAnonId'>,
    private readonly testLive: () => Promise<boolean> = isPassFirstTestLive
  ) {}

  async execute(
    surface: string | undefined,
    anonId: string | null
  ): Promise<PassFirstArm> {
    if (surface == null || !HELD_DECK_SURFACES.has(surface)) {
      return 'off';
    }
    if (!(await this.testLive())) {
      return 'off';
    }
    if (
      anonId == null ||
      anonId === '' ||
      isPlanHoldKey(anonId) ||
      isPreviewHoldKey(anonId)
    ) {
      return resolvePassFirstArm(anonId, true);
    }
    return this.armOfNewestHold(anonId);
  }

  private async armOfNewestHold(anonId: string): Promise<PassFirstArm> {
    try {
      const hold = await this.holds.findNewestByAnonId(anonId);
      if (hold == null) {
        return resolvePassFirstArm(anonId, true);
      }
      return isPassFirstTestArm(hold.pass_first_arm)
        ? hold.pass_first_arm
        : 'off';
    } catch (error) {
      console.error('[ResolveCheckoutPassFirstArm] hold lookup failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return 'off';
    }
  }
}

export function checkoutPassFirstArmFromHolds(
  database: Knex
): ResolveCheckoutPassFirstArmUseCase {
  return new ResolveCheckoutPassFirstArmUseCase(
    new HeldDeckRepository(database)
  );
}

export default ResolveCheckoutPassFirstArmUseCase;

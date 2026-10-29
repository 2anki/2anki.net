import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HELD_DECK_CHECKOUT_SURFACE } from './AnonymousPartialGate';

function readServerHeldDeckSurface(): string | null {
  const serverSource = readFileSync(
    join(
      __dirname,
      '../../../../src/usecases/uploads/ClaimHeldDeckWithPassUseCase.ts'
    ),
    'utf8'
  );
  const match = /HELD_DECK_CHECKOUT_SURFACE = '([a-z0-9_-]+)'/.exec(
    serverSource
  );
  return match == null ? null : match[1];
}

describe('web/server held-deck checkout surface parity', () => {
  it('checks out the held-deck gate under the surface the server releases', () => {
    expect(readServerHeldDeckSurface()).toBe(HELD_DECK_CHECKOUT_SURFACE);
  });
});

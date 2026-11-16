import { describe, expect, it } from 'vitest';
import { serializeTaskError } from './conversionChildProtocol';

describe('task errors across the conversion child', () => {
  it('carries no details payload from any error', () => {
    const thirdParty = Object.assign(new Error('x'), {
      details: { token: 'secret-value' },
    });

    expect(serializeTaskError(thirdParty)).not.toHaveProperty('details');
    expect(serializeTaskError(new Error('plain'))).not.toHaveProperty(
      'details'
    );
  });
});

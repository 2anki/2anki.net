import { describe, expect, it } from 'vitest';
import {
  rebuildTaskError,
  serializeTaskError,
} from './conversionChildProtocol';

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

  it('brings the message, name, code and source format back on the parent side', () => {
    const thrown = Object.assign(new Error('no cards in this page'), {
      name: 'EmptyDeckError',
      code: 'empty_deck',
      sourceFormat: 'markdown',
    });

    const rebuilt = rebuildTaskError(serializeTaskError(thrown));

    expect(rebuilt).toBeInstanceOf(Error);
    expect(rebuilt).toMatchObject({
      message: 'no cards in this page',
      name: 'EmptyDeckError',
      code: 'empty_deck',
      sourceFormat: 'markdown',
    });
  });

  it('turns a thrown value that is not an error into a plain error', () => {
    const rebuilt = rebuildTaskError(serializeTaskError('disk full'));

    expect(rebuilt).toMatchObject({ message: 'disk full', name: 'Error' });
    expect(rebuilt).not.toHaveProperty('code');
  });
});

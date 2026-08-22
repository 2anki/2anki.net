import { HttpCodedError, isHttpCodedClientFault } from './HttpCodedError';

class TeapotError extends HttpCodedError {
  constructor() {
    super('I am a teapot', 418, 'teapot');
  }
}

describe('HttpCodedError', () => {
  it('carries status, code, and message', () => {
    const err = new TeapotError();
    expect(err.status).toBe(418);
    expect(err.code).toBe('teapot');
    expect(err.message).toBe('I am a teapot');
    expect(err.name).toBe('TeapotError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpCodedError);
  });

  it.each([
    [402, true],
    [404, true],
    [499, true],
    [500, false],
    [503, false],
  ])('isHttpCodedClientFault for status %i is %s', (status, expected) => {
    const err = new HttpCodedError('x', status, 'x');
    expect(isHttpCodedClientFault(err)).toBe(expected);
  });

  it('isHttpCodedClientFault is false for plain errors', () => {
    expect(isHttpCodedClientFault(new Error('plain'))).toBe(false);
  });
});

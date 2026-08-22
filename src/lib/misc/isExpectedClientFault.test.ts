import { isExpectedClientFault } from './isExpectedClientFault';
import { HttpCodedError } from '../errors/HttpCodedError';

describe('isExpectedClientFault', () => {
  it('returns false for undefined', () => {
    expect(isExpectedClientFault(undefined)).toBe(false);
  });

  it('returns true for a body-parser malformed-JSON error', () => {
    const err = Object.assign(new SyntaxError('bad json'), {
      type: 'entity.parse.failed',
    });
    expect(isExpectedClientFault(err)).toBe(true);
  });

  it('returns true for an AnkiAppExportError by name', () => {
    const err = new Error('No cards found in this AnkiApp export.');
    err.name = 'AnkiAppExportError';
    expect(isExpectedClientFault(err)).toBe(true);
  });

  it('returns true for a multer client-abort error', () => {
    expect(isExpectedClientFault(new Error('Request aborted'))).toBe(true);
  });

  it('returns true for a raw-body aborted request', () => {
    const err = Object.assign(new Error('request aborted'), {
      code: 'ECONNABORTED',
      type: 'request.aborted',
    });
    expect(isExpectedClientFault(err)).toBe(true);
  });

  it('returns true for a request socket reset', () => {
    const err = Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
    expect(isExpectedClientFault(err)).toBe(true);
  });

  it('returns false for an ordinary error', () => {
    expect(isExpectedClientFault(new Error('database exploded'))).toBe(false);
  });

  it('returns false for a SyntaxError without the body-parser type tag', () => {
    expect(isExpectedClientFault(new SyntaxError('thrown by our code'))).toBe(
      false
    );
  });

  it('returns true for a 4xx HttpCodedError', () => {
    expect(
      isExpectedClientFault(new HttpCodedError('limit reached', 402, 'limit'))
    ).toBe(true);
  });

  it('returns false for a 5xx HttpCodedError', () => {
    expect(
      isExpectedClientFault(new HttpCodedError('upstream down', 503, 'up'))
    ).toBe(false);
  });
});

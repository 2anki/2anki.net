import { isExpectedClientFault } from './isExpectedClientFault';
import { HttpCodedError } from '../errors/HttpCodedError';

describe('isExpectedClientFault', () => {
  it('returns false for undefined', () => {
    expect(isExpectedClientFault(undefined)).toBe(false);
  });

  const clientFaultCases: Array<[string, () => Error]> = [
    [
      'a body-parser malformed-JSON error',
      () =>
        Object.assign(new SyntaxError('bad json'), {
          type: 'entity.parse.failed',
        }),
    ],
    [
      'an AnkiAppExportError by name',
      () => {
        const err = new Error('No cards found in this AnkiApp export.');
        err.name = 'AnkiAppExportError';
        return err;
      },
    ],
    ['a multer client-abort error', () => new Error('Request aborted')],
    [
      'a raw-body aborted request',
      () =>
        Object.assign(new Error('request aborted'), {
          code: 'ECONNABORTED',
          type: 'request.aborted',
        }),
    ],
    [
      'a request socket reset',
      () => Object.assign(new Error('aborted'), { code: 'ECONNRESET' }),
    ],
    [
      'a busboy truncated-upload abort',
      () => new Error('Unexpected end of form'),
    ],
    [
      'a 4xx HttpCodedError',
      () => new HttpCodedError('limit reached', 402, 'limit'),
    ],
    [
      'a 416 http-error from a bad Range header on a static file',
      () =>
        Object.assign(new Error('Range Not Satisfiable'), {
          name: 'RangeNotSatisfiableError',
          status: 416,
          statusCode: 416,
          expose: true,
        }),
    ],
  ];

  it.each(clientFaultCases)('returns true for %s', (_label, makeError) => {
    expect(isExpectedClientFault(makeError())).toBe(true);
  });

  it('returns false for an ordinary error', () => {
    expect(isExpectedClientFault(new Error('database exploded'))).toBe(false);
  });

  it('returns false for a SyntaxError without the body-parser type tag', () => {
    expect(isExpectedClientFault(new SyntaxError('thrown by our code'))).toBe(
      false
    );
  });

  it('returns false for a 5xx http-error even when marked expose', () => {
    expect(
      isExpectedClientFault(
        Object.assign(new Error('Internal Server Error'), {
          status: 500,
          statusCode: 500,
          expose: true,
        })
      )
    ).toBe(false);
  });

  it('returns false for a 4xx status that is not an exposed http-error', () => {
    expect(
      isExpectedClientFault(
        Object.assign(new Error('upstream rejected the call'), {
          status: 400,
        })
      )
    ).toBe(false);
  });

  it('returns false for a 5xx HttpCodedError', () => {
    expect(
      isExpectedClientFault(new HttpCodedError('upstream down', 503, 'up'))
    ).toBe(false);
  });
});

import express from 'express';

import {
  DEPLOY_SMOKE_HEADER,
  isDeploySmokeRequest,
} from './isDeploySmokeRequest';

function request(
  headers: Record<string, string>,
  remoteAddress: string | undefined
): express.Request {
  return { headers, socket: { remoteAddress } } as unknown as express.Request;
}

describe('isDeploySmokeRequest', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'accepts the smoke header on a direct loopback connection from %s',
    (remoteAddress) => {
      expect(
        isDeploySmokeRequest(
          request({ [DEPLOY_SMOKE_HEADER]: '1' }, remoteAddress)
        )
      ).toBe(true);
    }
  );

  it('rejects the smoke header when the request came through the proxy', () => {
    expect(
      isDeploySmokeRequest(
        request(
          { [DEPLOY_SMOKE_HEADER]: '1', 'x-forwarded-for': '203.0.113.9' },
          '127.0.0.1'
        )
      )
    ).toBe(false);
  });

  it('rejects the smoke header from a non-loopback address', () => {
    expect(
      isDeploySmokeRequest(
        request({ [DEPLOY_SMOKE_HEADER]: '1' }, '203.0.113.9')
      )
    ).toBe(false);
  });

  it('rejects a loopback request without the smoke header', () => {
    expect(isDeploySmokeRequest(request({}, '127.0.0.1'))).toBe(false);
  });

  it('rejects a smoke header with any value other than 1', () => {
    expect(
      isDeploySmokeRequest(
        request({ [DEPLOY_SMOKE_HEADER]: 'true' }, '127.0.0.1')
      )
    ).toBe(false);
  });

  it('rejects a request with no headers or socket', () => {
    expect(isDeploySmokeRequest({} as unknown as express.Request)).toBe(false);
  });
});

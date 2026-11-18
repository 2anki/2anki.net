import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import type express from 'express';

import { ConnectorArrivalController } from './ConnectorArrivalController';
import type {
  ConnectorArrival,
  RecordConnectorArrivalUseCase,
} from '../usecases/mcp/RecordConnectorArrivalUseCase';
import { setMintedAnonId } from '../lib/User/getOwner';

function request(
  cookies: Record<string, string>,
  headers: Record<string, string> = {},
  originalUrl = '/pricing/?ref=mcp&k=held&a=b'
): express.Request {
  return {
    method: 'GET',
    originalUrl,
    cookies,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as express.Request;
}

function response(): express.Response {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { locals: {} }) as unknown as express.Response;
}

function recorder() {
  const calls: ConnectorArrival[] = [];
  const useCase = {
    execute: vi.fn(async (arrival: ConnectorArrival) => {
      calls.push(arrival);
    }),
  } as unknown as RecordConnectorArrivalUseCase;
  return { calls, controller: new ConnectorArrivalController(() => useCase) };
}

describe('ConnectorArrivalController', () => {
  it('records nothing until the response has been sent', async () => {
    const { calls, controller } = recorder();
    const res = response();

    controller.recordAfterResponse(request({}), res);
    await Promise.resolve();
    expect(calls).toEqual([]);

    res.emit('finish');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
  });

  it.each([
    ['granted', 'anon-minted'],
    ['denied', null],
  ])(
    'passes the id minted on this request only when consent is %s',
    async (consent, expected) => {
      const { calls, controller } = recorder();
      const res = response();
      setMintedAnonId(res, 'anon-minted');

      controller.recordAfterResponse(
        request({ cookie_consent: consent, token: 'session-cookie' }),
        res
      );
      res.emit('finish');

      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({
        anonymousId: expected,
        sessionToken: 'session-cookie',
      });
      expect(calls[0].query.get('k')).toBe('held');
    }
  );

  it.each([
    [
      'a chat client fetching the link',
      {
        'user-agent': 'Mozilla/5.0 (compatible; ChatGPT-User/1.0)',
        'sec-purpose': 'prefetch',
      },
      { fetchSite: 'absent', prefetch: true, uaClass: 'fetcher' },
    ],
    [
      'a click from a chat web page',
      {
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/131.0 Safari/537.36',
        'sec-fetch-site': 'cross-site',
      },
      { fetchSite: 'cross-site', prefetch: false, uaClass: 'browser' },
    ],
    [
      'a return from our own sign-in',
      {
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/131.0 Safari/537.36',
        'sec-fetch-site': 'same-origin',
      },
      { fetchSite: 'same-origin', prefetch: false, uaClass: 'browser' },
    ],
    [
      'a garbage fetch site header',
      { 'user-agent': 'SomeTool 1.0', 'sec-fetch-site': 'nonsense' },
      { fetchSite: 'other', prefetch: false, uaClass: 'unknown' },
    ],
  ])('labels %s from its headers', async (_label, headers, labels) => {
    const { calls, controller } = recorder();
    const res = response();

    controller.recordAfterResponse(request({}, headers), res);
    res.emit('finish');

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].request).toEqual(labels);
  });

  it.each([
    '/pricing/?ref=MCP&k=held',
    '/pricing/?ref=Mcp',
    '/pricing/?ref=mcp2',
  ])(
    'records nothing for a ref that is not exactly mcp: %s',
    async (originalUrl) => {
      const { calls, controller } = recorder();
      const res = response();

      controller.recordAfterResponse(request({}, {}, originalUrl), res);
      res.emit('finish');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(calls).toEqual([]);
    }
  );
});

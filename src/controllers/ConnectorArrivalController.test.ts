import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import type express from 'express';

import { ConnectorArrivalController } from './ConnectorArrivalController';
import type {
  ConnectorArrival,
  RecordConnectorArrivalUseCase,
} from '../usecases/mcp/RecordConnectorArrivalUseCase';
import { setMintedAnonId } from '../lib/User/getOwner';

function request(cookies: Record<string, string>): express.Request {
  return {
    method: 'GET',
    originalUrl: '/pricing/?ref=mcp&k=held&a=b',
    cookies,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    get: () => undefined,
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
});

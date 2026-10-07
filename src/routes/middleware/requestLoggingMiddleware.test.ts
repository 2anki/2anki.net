import { vi } from 'vitest';
import { EventEmitter } from 'events';

import { makeRequestLoggingMiddleware } from './requestLoggingMiddleware';
import {
  RequestLogRow,
  OutboundCallLogRow,
  IObservabilityRepository,
} from '../../data_layer/ObservabilityRepository';
import { ObservabilitySink } from '../../services/observability/ObservabilitySink';

class FakeRepo implements IObservabilityRepository {
  inbound: RequestLogRow[] = [];
  outbound: OutboundCallLogRow[] = [];

  insertRequestLogs = async (rows: RequestLogRow[]) => {
    this.inbound.push(...rows);
  };
  insertOutboundCallLogs = async (rows: OutboundCallLogRow[]) => {
    this.outbound.push(...rows);
  };
  deleteOlderThan = async () => ({ requestLogs: 0, outboundCallLogs: 0 });
  aggregateInboundByStatusClass = async () => [];
  topRoutesByLatency = async () => [];
  aggregateOutboundByService = async () => [];
  outboundLatencyByService = async () => [];
  errorRateByRoute = async () => [];
  errorRateByService = async () => [];
}

interface FakeReq {
  method: string;
  path: string;
  route?: { path: string };
  baseUrl?: string;
}

interface FakeRes extends EventEmitter {
  statusCode: number;
}

const makeReq = (overrides: Partial<FakeReq> = {}): FakeReq => ({
  method: 'GET',
  path: '/api/upload',
  ...overrides,
});

const makeRes = (statusCode = 200): FakeRes => {
  const emitter = new EventEmitter() as FakeRes;
  emitter.statusCode = statusCode;
  return emitter;
};

describe('requestLoggingMiddleware', () => {
  it('records method, route template, status, and duration after res.finish', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const middleware = makeRequestLoggingMiddleware(sink);

    const req = makeReq({ route: { path: '/api/upload/:id' } });
    const res = makeRes(200);
    const next = vi.fn();

    middleware(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.emit('finish');
    await sink.flush();

    expect(repo.inbound).toHaveLength(1);
    expect(repo.inbound[0]).toMatchObject({
      method: 'GET',
      route: '/api/upload/:id',
      status_code: 200,
    });
    expect(repo.inbound[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(repo.inbound[0].created_at).toBeInstanceOf(Date);
  });

  it('falls back to "unmatched" when no route was matched (404)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const middleware = makeRequestLoggingMiddleware(sink);

    const req = makeReq({ path: '/totally/random/path' });
    const res = makeRes(404);

    middleware(req as never, res as never, vi.fn());
    res.emit('finish');
    await sink.flush();

    expect(repo.inbound[0].route).toBe('unmatched');
  });

  it('skips /ops itself to avoid feedback loops', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const middleware = makeRequestLoggingMiddleware(sink);

    const req = makeReq({ path: '/ops' });
    const res = makeRes(200);

    middleware(req as never, res as never, vi.fn());
    res.emit('finish');
    await sink.flush();

    expect(repo.inbound).toHaveLength(0);
  });

  it('skips /api/ops/* so the dashboard does not log its own polling', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const middleware = makeRequestLoggingMiddleware(sink);

    const req = makeReq({ path: '/api/ops/metrics' });
    const res = makeRes(200);

    middleware(req as never, res as never, vi.fn());
    res.emit('finish');
    await sink.flush();

    expect(repo.inbound).toHaveLength(0);
  });

  it('does not throw when sink throws synchronously (request must never be blocked)', async () => {
    const sink = {
      recordRequest: () => {
        throw new Error('boom');
      },
    };
    const middleware = makeRequestLoggingMiddleware(sink as never);

    const req = makeReq({ route: { path: '/api/upload/:id' } });
    const res = makeRes(500);
    const next = vi.fn();
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    middleware(req as never, res as never, next);
    expect(() => res.emit('finish')).not.toThrow();

    expect(next).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('prefixes baseUrl + route.path so mounted routers keep their prefix', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const middleware = makeRequestLoggingMiddleware(sink);

    const req = makeReq({
      baseUrl: '/api/ankify',
      route: { path: '/clients/:id' },
    });
    const res = makeRes(200);

    middleware(req as never, res as never, vi.fn());
    res.emit('finish');
    await sink.flush();

    expect(repo.inbound[0].route).toBe('/api/ankify/clients/:id');
  });
});

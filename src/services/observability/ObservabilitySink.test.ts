import { vi } from 'vitest';
import {
  ObservabilitySink,
  OBSERVABILITY_FLUSH_THRESHOLD,
} from './ObservabilitySink';
import {
  IObservabilityRepository,
  RequestLogRow,
  OutboundCallLogRow,
} from '../../data_layer/ObservabilityRepository';

class FakeRepo implements IObservabilityRepository {
  inboundBatches: RequestLogRow[][] = [];
  outboundBatches: OutboundCallLogRow[][] = [];
  failNext = false;

  insertRequestLogs = async (rows: RequestLogRow[]) => {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('insert failed');
    }
    this.inboundBatches.push(rows);
  };

  insertOutboundCallLogs = async (rows: OutboundCallLogRow[]) => {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('insert failed');
    }
    this.outboundBatches.push(rows);
  };

  deleteOlderThan = async () => ({ requestLogs: 0, outboundCallLogs: 0 });
  aggregateInboundByStatusClass = async () => [];
  topRoutesByLatency = async () => [];
  aggregateOutboundByService = async () => [];
  outboundLatencyByService = async () => [];
  errorRateByRoute = async () => [];
  errorRateByService = async () => [];
}

const sampleRequest = (
  overrides: Partial<RequestLogRow> = {}
): RequestLogRow => ({
  method: 'GET',
  route: '/api/upload',
  status_code: 200,
  duration_ms: 12,
  created_at: new Date(),
  ...overrides,
});

const sampleOutbound = (
  overrides: Partial<OutboundCallLogRow> = {}
): OutboundCallLogRow => ({
  service: 'notion',
  endpoint: 'api.notion.com/v1/pages',
  status_code: 200,
  duration_ms: 99,
  created_at: new Date(),
  ...overrides,
});

describe('ObservabilitySink', () => {
  it('buffers writes and only persists on flush', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);

    sink.recordRequest(sampleRequest());
    sink.recordOutboundCall(sampleOutbound());
    expect(repo.inboundBatches).toHaveLength(0);
    expect(repo.outboundBatches).toHaveLength(0);

    await sink.flush();
    expect(repo.inboundBatches).toEqual([[expect.any(Object)]]);
    expect(repo.outboundBatches).toEqual([[expect.any(Object)]]);
  });

  it('flushes automatically once the inbound buffer hits the threshold', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);

    for (let i = 0; i < OBSERVABILITY_FLUSH_THRESHOLD; i++) {
      sink.recordRequest(sampleRequest());
    }
    await sink.waitForPendingFlush();

    expect(repo.inboundBatches).toHaveLength(1);
    expect(repo.inboundBatches[0]).toHaveLength(OBSERVABILITY_FLUSH_THRESHOLD);
  });

  it('flushes automatically once the outbound buffer hits the threshold', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);

    for (let i = 0; i < OBSERVABILITY_FLUSH_THRESHOLD; i++) {
      sink.recordOutboundCall(sampleOutbound());
    }
    await sink.waitForPendingFlush();

    expect(repo.outboundBatches).toHaveLength(1);
    expect(repo.outboundBatches[0]).toHaveLength(OBSERVABILITY_FLUSH_THRESHOLD);
  });

  it('drops the batch and logs to stderr when an insert fails (never blocks recording)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    repo.failNext = true;
    sink.recordRequest(sampleRequest());
    await sink.flush();

    expect(errSpy).toHaveBeenCalled();
    expect(repo.inboundBatches).toHaveLength(0);

    sink.recordRequest(sampleRequest());
    await sink.flush();
    expect(repo.inboundBatches).toHaveLength(1);

    errSpy.mockRestore();
  });

  it('flush is a no-op when nothing is buffered', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    await sink.flush();
    expect(repo.inboundBatches).toHaveLength(0);
    expect(repo.outboundBatches).toHaveLength(0);
  });
});

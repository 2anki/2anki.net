import { vi, type Mock } from 'vitest';
import { GetOpsMetricsUseCase } from './GetOpsMetricsUseCase';
import {
  ObservabilityQueryService,
  OpsMetricsResponse,
} from '../../services/observability/ObservabilityQueryService';
import { IObservabilityRepository } from '../../data_layer/ObservabilityRepository';

class StubRepo implements IObservabilityRepository {
  insertRequestLogs = async () => {};
  insertOutboundCallLogs = async () => {};
  deleteOlderThan = async () => ({ requestLogs: 0, outboundCallLogs: 0 });
  aggregateInboundByStatusClass = async () => [];
  topRoutesByLatency = async () => [];
  aggregateOutboundByService = async () => [];
  outboundLatencyByService = async () => [];
  errorRateByRoute = async () => [];
  errorRateByService = async () => [];
}

describe('GetOpsMetricsUseCase', () => {
  it('defaults to 24h when window is omitted', async () => {
    const service = new ObservabilityQueryService(new StubRepo());
    const useCase = new GetOpsMetricsUseCase(service);
    const result = await useCase.execute(undefined);
    expect(result.window).toBe('24h');
  });

  it('defaults to 24h when window is invalid', async () => {
    const service = new ObservabilityQueryService(new StubRepo());
    const useCase = new GetOpsMetricsUseCase(service);
    const result = await useCase.execute('mystery');
    expect(result.window).toBe('24h');
  });

  it('honors a valid window', async () => {
    const service = new ObservabilityQueryService(new StubRepo());
    const useCase = new GetOpsMetricsUseCase(service);
    const result = await useCase.execute('1h');
    expect(result.window).toBe('1h');
  });

  it('passes through service results unchanged', async () => {
    const fakeResponse = {
      window: '7d',
      bucket_seconds: 3600,
      generated_at: 'now',
      inbound_volume: [],
      route_latency: [],
      outbound_volume: [],
      outbound_latency_by_service: [],
      error_rate_by_route: [],
      error_rate_by_service: [],
      unsupported_blocks: [],
      conversion_output: [],
      parse_path_signatures: [],
    } as OpsMetricsResponse;
    const service = {
      getMetrics: vi.fn().mockResolvedValue(fakeResponse),
    } as unknown as ObservabilityQueryService;
    const useCase = new GetOpsMetricsUseCase(service);
    const result = await useCase.execute('7d');
    expect(result).toBe(fakeResponse);
    expect(service.getMetrics as Mock).toHaveBeenCalledWith('7d');
  });
});

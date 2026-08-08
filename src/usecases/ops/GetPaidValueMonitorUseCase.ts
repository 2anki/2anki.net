import {
  PaidValueMonitorResponse,
  PaidValueMonitorService,
} from '../../services/ops/PaidValueMonitorService';

const SECONDS_PER_DAY = 24 * 60 * 60;

const WINDOW_DAYS: Record<string, number> = {
  '1d': 1,
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

const DEFAULT_WINDOW = '7d';

export class GetPaidValueMonitorUseCase {
  constructor(private readonly service: PaidValueMonitorService) {}

  execute(window: string | undefined): Promise<PaidValueMonitorResponse> {
    const key =
      window != null && WINDOW_DAYS[window] != null ? window : DEFAULT_WINDOW;
    const days = WINDOW_DAYS[key];
    const now = new Date();
    const since = new Date(now.getTime() - days * SECONDS_PER_DAY * 1000);
    return this.service.getStatus(since, now);
  }
}

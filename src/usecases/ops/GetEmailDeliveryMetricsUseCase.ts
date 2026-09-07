import {
  EmailDeliveryMetricsService,
  EmailDeliveryMetricsResponse,
} from '../../services/ops/EmailDeliveryMetricsService';

const SECONDS_PER_DAY = 24 * 60 * 60;

const WINDOW_DAYS: Record<string, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '60d': 60,
  '90d': 90,
};

const DEFAULT_WINDOW = '30d';

export interface EmailDeliveryMetricsPayload extends EmailDeliveryMetricsResponse {
  window: string;
}

export class GetEmailDeliveryMetricsUseCase {
  constructor(private readonly service: EmailDeliveryMetricsService) {}

  async execute(
    window: string | undefined
  ): Promise<EmailDeliveryMetricsPayload> {
    const key =
      window != null && WINDOW_DAYS[window] != null ? window : DEFAULT_WINDOW;
    const days = WINDOW_DAYS[key];
    const since = new Date(Date.now() - days * SECONDS_PER_DAY * 1000);
    const metrics = await this.service.getMetrics(since);
    return { window: key, ...metrics };
  }
}

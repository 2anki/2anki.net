import type { IEventsRepository } from '../../data_layer/EventsRepository';
import type {
  CancelFunnelResponse,
  CancelFunnelStages,
} from '../../types/ops/CancelFunnel';

export type { CancelFunnelResponse, CancelFunnelStages };

interface CancelFunnelServiceDeps {
  eventsRepo: IEventsRepository;
}

export class CancelFunnelService {
  private readonly eventsRepo: IEventsRepository;

  constructor(deps: CancelFunnelServiceDeps) {
    this.eventsRepo = deps.eventsRepo;
  }

  async getMetrics(since: Date): Promise<CancelFunnelResponse> {
    const as_of = new Date().toISOString();
    const sinceStr = since.toISOString();

    let stages: CancelFunnelStages;
    try {
      const [cancel_started, cancelled] = await Promise.all([
        this.eventsRepo.countByName('subscription_cancel_started', since),
        this.eventsRepo.countByName('subscription_cancelled', since),
      ]);
      stages = { cancel_started, cancelled };
    } catch (err) {
      return {
        stages: null,
        since: sinceStr,
        as_of,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return { stages, since: sinceStr, as_of };
  }
}

import type { IEventsRepository } from '../../data_layer/EventsRepository';
import type {
  CancelFunnelResponse,
  CancelFunnelStages,
} from '../../types/ops/CancelFunnel';

export type { CancelFunnelResponse, CancelFunnelStages };

interface CancelFunnelServiceDeps {
  eventsRepo: IEventsRepository;
}

const rate = (numerator: number, denominator: number): number =>
  denominator > 0 ? (numerator / denominator) * 100 : 0;

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
      const [
        cancel_started,
        pause_offered,
        paused,
        cancelled,
        pause_offer_declined,
      ] = await Promise.all([
        this.eventsRepo.countByName('subscription_cancel_started', since),
        this.eventsRepo.countByName('subscription_pause_offered', since),
        this.eventsRepo.countByName('subscription_paused', since),
        this.eventsRepo.countByName('subscription_cancelled', since),
        this.eventsRepo.countByName('subscription_pause_offer_declined', since),
      ]);
      stages = {
        cancel_started,
        pause_offered,
        paused,
        cancelled,
        pause_offer_declined,
      };
    } catch (err) {
      return {
        stages: null,
        save_rate_pct: 0,
        offer_reach_pct: 0,
        since: sinceStr,
        as_of,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      stages,
      save_rate_pct: rate(stages.paused, stages.pause_offered),
      offer_reach_pct: rate(stages.pause_offered, stages.cancel_started),
      since: sinceStr,
      as_of,
    };
  }
}

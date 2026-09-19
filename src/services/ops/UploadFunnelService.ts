import type {
  IEventsRepository,
  UploadFunnelStageRow,
  UploadFunnelStageByOriginRow,
  ConversionFailedByReasonRow,
} from '../../data_layer/EventsRepository';

export interface UploadFunnelStages {
  upload_started: number;
  conversion_succeeded: number;
  conversion_failed: number;
  deck_downloaded: number;
  paywall_shown: number;
  signup: number;
  paid: number;
}

export interface UploadFunnelRates {
  upload_to_download_rate_pct: number;
  download_to_signup_rate_pct: number;
  download_to_paid_rate_pct: number;
}

export interface UploadFunnelOriginBreakdown extends UploadFunnelRates {
  origin: string | null;
  stages: UploadFunnelStages;
}

export interface ConversionFailedByReason {
  paywall: number;
  empty: number;
  technical: number;
}

export interface UploadFunnelResponse extends UploadFunnelRates {
  stages: UploadFunnelStages | null;
  by_origin: UploadFunnelOriginBreakdown[];
  conversion_failed_by_reason: ConversionFailedByReason;
  signup_reliable: boolean;
  since: string;
  as_of: string;
  error?: string;
}

const ACCOUNT_CREATED_RELIABLE_SINCE = new Date('2026-09-08T00:00:00.000Z');

interface UploadFunnelServiceDeps {
  eventsRepo: IEventsRepository;
}

export class UploadFunnelService {
  private readonly eventsRepo: IEventsRepository;

  constructor(deps: UploadFunnelServiceDeps) {
    this.eventsRepo = deps.eventsRepo;
  }

  async getMetrics(since: Date): Promise<UploadFunnelResponse> {
    const as_of = new Date().toISOString();
    const sinceStr = since.toISOString();
    const signup_reliable =
      since.getTime() >= ACCOUNT_CREATED_RELIABLE_SINCE.getTime();

    let rows: UploadFunnelStageRow[];
    let originRows: UploadFunnelStageByOriginRow[];
    let failedByReason: ConversionFailedByReasonRow;
    try {
      [rows, originRows, failedByReason] = await Promise.all([
        this.eventsRepo.groupUploadFunnel(since),
        this.eventsRepo.groupUploadFunnelByOrigin(since),
        this.eventsRepo.groupConversionFailedByReason(since),
      ]);
    } catch (err) {
      return {
        stages: null,
        by_origin: [],
        conversion_failed_by_reason: { paywall: 0, empty: 0, technical: 0 },
        upload_to_download_rate_pct: 0,
        download_to_signup_rate_pct: 0,
        download_to_paid_rate_pct: 0,
        signup_reliable,
        since: sinceStr,
        as_of,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const stages = this.toStages(rows);

    return {
      stages,
      by_origin: this.toOriginBreakdowns(originRows),
      conversion_failed_by_reason: {
        paywall: failedByReason.paywall,
        empty: failedByReason.empty,
        technical: failedByReason.technical,
      },
      ...computeRates(stages),
      signup_reliable,
      since: sinceStr,
      as_of,
    };
  }

  private toStages(rows: UploadFunnelStageRow[]): UploadFunnelStages {
    const byStage = new Map<string, number>();
    for (const row of rows) {
      byStage.set(row.stage, row.distinct_identities);
    }
    return {
      upload_started: byStage.get('upload_started') ?? 0,
      conversion_succeeded: byStage.get('conversion_succeeded') ?? 0,
      conversion_failed: byStage.get('conversion_failed') ?? 0,
      deck_downloaded: byStage.get('deck_downloaded') ?? 0,
      paywall_shown: byStage.get('paywall_shown') ?? 0,
      signup: byStage.get('account_created') ?? 0,
      paid: byStage.get('checkout_completed') ?? 0,
    };
  }

  private toOriginBreakdowns(
    rows: UploadFunnelStageByOriginRow[]
  ): UploadFunnelOriginBreakdown[] {
    const byOrigin = new Map<string | null, UploadFunnelStageRow[]>();
    for (const row of rows) {
      const bucket = byOrigin.get(row.origin) ?? [];
      bucket.push({
        stage: row.stage,
        distinct_identities: row.distinct_identities,
      });
      byOrigin.set(row.origin, bucket);
    }

    return [...byOrigin.entries()]
      .map(([origin, stageRows]) => {
        const stages = this.toStages(stageRows);
        return { origin, stages, ...computeRates(stages) };
      })
      .sort((a, b) => b.stages.upload_started - a.stages.upload_started);
  }
}

function computeRates(stages: UploadFunnelStages): UploadFunnelRates {
  return {
    upload_to_download_rate_pct:
      stages.upload_started > 0
        ? (stages.deck_downloaded / stages.upload_started) * 100
        : 0,
    download_to_signup_rate_pct:
      stages.deck_downloaded > 0
        ? (stages.signup / stages.deck_downloaded) * 100
        : 0,
    download_to_paid_rate_pct:
      stages.deck_downloaded > 0
        ? (stages.paid / stages.deck_downloaded) * 100
        : 0,
  };
}

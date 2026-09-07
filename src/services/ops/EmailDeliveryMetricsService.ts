import {
  EmailDeliveryCount,
  IEmailDeliveryMetricsRepository,
} from '../../data_layer/EmailDeliveryMetricsRepository';

// SendGrid event types recorded by ProcessSendgridEventsUseCase. Delivered is
// the success signal; bounce/dropped/blocked are hard failures; deferred is a
// retry in flight, spamreport/unsubscribe are recipient choices — neither
// counts toward failure_rate.
const FAILURE_TYPES: ReadonlySet<string> = new Set([
  'bounce',
  'dropped',
  'blocked',
]);

export interface EmailDeliveryCategory {
  category: string;
  delivered: number;
  bounce: number;
  dropped: number;
  blocked: number;
  deferred: number;
  spamreport: number;
  unsubscribe: number;
  failure_rate: number;
}

export interface EmailDeliveryMetricsResponse {
  by_category: EmailDeliveryCategory[];
}

const COUNTED_TYPES: ReadonlySet<string> = new Set([
  'delivered',
  'bounce',
  'dropped',
  'blocked',
  'deferred',
  'spamreport',
  'unsubscribe',
]);

type CountedType =
  | 'delivered'
  | 'bounce'
  | 'dropped'
  | 'blocked'
  | 'deferred'
  | 'spamreport'
  | 'unsubscribe';

function emptyCategory(category: string): EmailDeliveryCategory {
  return {
    category,
    delivered: 0,
    bounce: 0,
    dropped: 0,
    blocked: 0,
    deferred: 0,
    spamreport: 0,
    unsubscribe: 0,
    failure_rate: 0,
  };
}

export function shapeEmailDeliveryCounts(
  counts: EmailDeliveryCount[]
): EmailDeliveryCategory[] {
  const byCategory = new Map<string, EmailDeliveryCategory>();
  for (const { category, event_type, count } of counts) {
    const row = byCategory.get(category) ?? emptyCategory(category);
    if (COUNTED_TYPES.has(event_type)) {
      row[event_type as CountedType] += count;
    }
    byCategory.set(category, row);
  }
  const rows = [...byCategory.values()];
  for (const row of rows) {
    const failures = [...FAILURE_TYPES].reduce(
      (sum, type) => sum + row[type as CountedType],
      0
    );
    const attempts = row.delivered + failures;
    row.failure_rate =
      attempts > 0 ? Math.round((failures / attempts) * 1000) / 10 : 0;
  }
  return rows.sort((a, b) => b.failure_rate - a.failure_rate);
}

export class EmailDeliveryMetricsService {
  constructor(
    private readonly deps: { repo: IEmailDeliveryMetricsRepository }
  ) {}

  async getMetrics(since: Date): Promise<EmailDeliveryMetricsResponse> {
    const counts = await this.deps.repo.countsByCategory(since);
    return { by_category: shapeEmailDeliveryCounts(counts) };
  }
}

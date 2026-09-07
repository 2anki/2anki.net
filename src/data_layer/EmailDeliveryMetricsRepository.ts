import type { Knex } from 'knex';

const EMAIL_DELIVERY_EVENT = 'email_delivery_event';

export interface EmailDeliveryRow {
  category: string | null;
  event_type: string | null;
  count: number | string;
}

export interface EmailDeliveryCount {
  category: string;
  event_type: string;
  count: number;
}

export interface IEmailDeliveryMetricsRepository {
  countsByCategory(since: Date): Promise<EmailDeliveryCount[]>;
}

export function mapEmailDeliveryRows(
  rows: EmailDeliveryRow[]
): EmailDeliveryCount[] {
  return rows.map((row) => ({
    category: row.category ?? 'uncategorized',
    event_type: row.event_type ?? 'unknown',
    count: Number(row.count ?? 0),
  }));
}

export class EmailDeliveryMetricsRepository implements IEmailDeliveryMetricsRepository {
  constructor(private readonly database: Knex) {}

  buildCountsQuery(since: Date): Knex.QueryBuilder {
    return this.database('events')
      .where('name', EMAIL_DELIVERY_EVENT)
      .where('created_at', '>=', since)
      .select(
        this.database.raw("props->>'category' as category"),
        this.database.raw("props->>'event_type' as event_type"),
        this.database.raw('count(*) as count')
      )
      .groupByRaw("props->>'category', props->>'event_type'")
      .orderByRaw("props->>'category'");
  }

  async countsByCategory(since: Date): Promise<EmailDeliveryCount[]> {
    const rows = (await this.buildCountsQuery(since)) as EmailDeliveryRow[];
    return mapEmailDeliveryRows(rows);
  }
}

export default EmailDeliveryMetricsRepository;

import {
  DuplicateSuppressionEventError,
  ISuppressionEventsRepository,
  SuppressionEventType,
} from '../../data_layer/SuppressionEventsRepository';
import { emailHash } from '../../lib/emailHash';

const TRACKED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'bounce',
  'dropped',
  'spamreport',
  'blocked',
  'deferred',
  'delivered',
  'unsubscribe',
]);

export interface SendgridEvent {
  email?: unknown;
  event?: unknown;
  sg_event_id?: unknown;
  timestamp?: unknown;
  category?: unknown;
}

export interface ProcessSendgridEventsResult {
  recorded: number;
  skipped: number;
  duplicates: number;
  categories: Record<string, number>;
}

const UNCATEGORIZED = 'uncategorized';

function isTrackedEvent(value: unknown): value is SuppressionEventType {
  return typeof value === 'string' && TRACKED_EVENT_TYPES.has(value);
}

function normalizeCategory(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' && first.length > 0 ? first : null;
  }
  return null;
}

function toEventDate(timestamp: unknown): Date {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return new Date(timestamp * 1000);
  }
  return new Date();
}

export class ProcessSendgridEventsUseCase {
  constructor(private readonly repository: ISuppressionEventsRepository) {}

  async execute(events: SendgridEvent[]): Promise<ProcessSendgridEventsResult> {
    const result: ProcessSendgridEventsResult = {
      recorded: 0,
      skipped: 0,
      duplicates: 0,
      categories: {},
    };

    for (const event of events) {
      const email = event.email;
      const sgEventId = event.sg_event_id;
      const hasIdentity =
        typeof email === 'string' &&
        email.length > 0 &&
        typeof sgEventId === 'string' &&
        sgEventId.length > 0;
      if (!hasIdentity || !isTrackedEvent(event.event)) {
        result.skipped += 1;
        continue;
      }

      try {
        await this.repository.record({
          emailHash: emailHash(email),
          eventType: event.event,
          sgEventId,
          eventAt: toEventDate(event.timestamp),
        });
        result.recorded += 1;
        const category = normalizeCategory(event.category) ?? UNCATEGORIZED;
        result.categories[category] = (result.categories[category] ?? 0) + 1;
      } catch (err) {
        if (err instanceof DuplicateSuppressionEventError) {
          result.duplicates += 1;
          continue;
        }
        throw err;
      }
    }

    return result;
  }
}

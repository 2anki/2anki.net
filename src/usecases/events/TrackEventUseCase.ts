import { EventsSink } from '../../services/events/EventsSink';
import { KnownEvent } from '../../types/AnalyticsEvents';
import { sanitizeForLog } from '../../lib/log/sanitizeForLog';

const PII_KEY_PATTERN = /email|token|password|filename|content|title/i;
const PROPS_MAX_BYTES = 1024;

export interface TrackEventInput {
  name: string;
  unknown: boolean;
  userId: number | null;
  anonymousId: string | null;
  props: Record<string, unknown>;
}

export class TrackEventUseCase {
  constructor(private readonly sink: EventsSink) {}

  execute(input: TrackEventInput): void {
    const { name, unknown, userId, anonymousId, props } = input;
    if (unknown) {
      console.warn(`[events] unknown event received: ${sanitizeForLog(name)}`);
    }
    const safeProps = this.stripPiiKeys(props);
    const serialized = JSON.stringify(safeProps);
    if (serialized.length > PROPS_MAX_BYTES) {
      throw new Error('Event props exceed 1 KB limit');
    }
    this.sink.record({
      name,
      user_id: userId,
      anonymous_id: anonymousId,
      props: safeProps,
      created_at: new Date(),
    });
  }

  private stripPiiKeys(
    props: Record<string, unknown>
  ): Record<string, unknown> {
    const stripped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (!PII_KEY_PATTERN.test(key)) {
        stripped[key] = value;
      }
    }
    return stripped;
  }
}

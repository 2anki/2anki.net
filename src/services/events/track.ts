import { KnownEvent } from '../../types/AnalyticsEvents';
import { getEventsSink } from './eventsSinkInstance';

const PII_KEY_PATTERN = /email|token|password|filename|content|title/i;
const PROPS_MAX_BYTES = 1024;

export interface TrackOptions {
  userId?: number | null;
  anonymousId?: string | null;
  anonymousPassId?: number | null;
  props?: Record<string, unknown>;
}

function stripPiiKeys(props: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!PII_KEY_PATTERN.test(key)) {
      stripped[key] = value;
    }
  }
  return stripped;
}

export function track(name: KnownEvent, options: TrackOptions = {}): void {
  const { userId, anonymousId, anonymousPassId, props = {} } = options;
  const safeProps = stripPiiKeys(props);
  const serialized = JSON.stringify(safeProps);
  if (serialized.length > PROPS_MAX_BYTES) {
    console.error(
      `[events] dropping event "${name}": props exceed ${PROPS_MAX_BYTES} bytes`
    );
    return;
  }
  getEventsSink().record({
    name,
    user_id: userId ?? null,
    anonymous_id: anonymousId ?? null,
    anonymous_pass_id: anonymousPassId ?? null,
    props: safeProps,
    created_at: new Date(),
  });
}

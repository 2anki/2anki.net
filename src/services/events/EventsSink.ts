import { IEventsRepository, EventRow } from '../../data_layer/EventsRepository';

export const EVENTS_FLUSH_THRESHOLD = 100;
export const EVENTS_FLUSH_INTERVAL_MS = 5000;

// Looks up users.signup_origin for a batch of user ids. Wired at the instance
// level so server-emitted funnel events (Stripe webhook checkout_completed,
// worker paywall_shown) attribute to a landing page instead of the null
// bucket (#4051) — browser events already carry the origin from the
// first_touch cookie and are left untouched.
export type SignupOriginResolver = (
  userIds: number[]
) => Promise<Map<number, string | null>>;

function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code === '23503'
  );
}

export class EventsSink {
  private buffer: EventRow[] = [];

  private intervalHandle: NodeJS.Timeout | null = null;

  private pendingFlush: Promise<void> | null = null;

  constructor(
    private readonly repository: IEventsRepository,
    private readonly options: {
      flushThreshold?: number;
      flushIntervalMs?: number;
      signupOriginResolver?: SignupOriginResolver;
    } = {}
  ) {}

  start() {
    if (this.intervalHandle != null) return;
    const interval = this.options.flushIntervalMs ?? EVENTS_FLUSH_INTERVAL_MS;
    this.intervalHandle = setInterval(() => {
      void this.flush();
    }, interval);
    this.intervalHandle.unref();
  }

  stop() {
    if (this.intervalHandle != null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  record(row: EventRow) {
    this.buffer.push(row);
    this.maybeFlush();
  }

  async flush(): Promise<void> {
    const rows = this.buffer;
    this.buffer = [];
    if (rows.length === 0) return;
    await this.enrichSignupOrigins(rows);
    await this.repository.insertEvents(rows).catch(async (error) => {
      if (isForeignKeyViolation(error)) {
        await this.salvageRows(rows);
        return;
      }
      console.error(`[events] dropping ${rows.length} event(s):`, error);
    });
  }

  // A row whose user was deleted between record() and flush() fails the whole
  // batch insert; re-inserting it anonymously keeps the funnel count while the
  // other rows land untouched.
  private async salvageRows(rows: EventRow[]): Promise<void> {
    for (const row of rows) {
      try {
        await this.repository.insertEvents([row]);
      } catch (rowError) {
        if (!isForeignKeyViolation(rowError)) {
          console.error('[events] dropping 1 event:', rowError);
          continue;
        }
        await this.repository
          .insertEvents([{ ...row, user_id: null }])
          .catch((anonError) => {
            console.error('[events] dropping 1 event:', anonError);
          });
      }
    }
  }

  private async enrichSignupOrigins(rows: EventRow[]): Promise<void> {
    const resolver = this.options.signupOriginResolver;
    if (resolver == null) return;
    const needing = rows.filter(
      (row) =>
        row.user_id != null &&
        (row.props as Record<string, unknown>)?.signup_origin == null
    );
    if (needing.length === 0) return;
    const userIds = [...new Set(needing.map((row) => Number(row.user_id)))];
    let origins: Map<number, string | null>;
    try {
      origins = await resolver(userIds);
    } catch (error) {
      console.error('[events] signup_origin enrichment failed:', error);
      return;
    }
    for (const row of needing) {
      const origin = origins.get(Number(row.user_id));
      if (origin != null) {
        row.props = { ...row.props, signup_origin: origin };
      }
    }
  }

  waitForPendingFlush(): Promise<void> {
    return this.pendingFlush ?? Promise.resolve();
  }

  private maybeFlush() {
    const threshold = this.options.flushThreshold ?? EVENTS_FLUSH_THRESHOLD;
    if (this.buffer.length < threshold) return;
    if (this.pendingFlush != null) return;
    this.pendingFlush = this.flush().finally(() => {
      this.pendingFlush = null;
    });
  }
}

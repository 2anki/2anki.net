// Callers sharing one queued load. Its signal aborts only once every caller
// has gone and none of them joined without a signal, and never after the
// load has started.
export class SharedInterest {
  private readonly controller = new AbortController();
  private waiting = 0;
  private hasCallerWithoutSignal = false;
  private committed = false;

  constructor(private readonly onAbandoned: () => void) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  join(signal?: AbortSignal): void {
    if (this.committed || this.controller.signal.aborted) return;
    if (signal == null) {
      this.hasCallerWithoutSignal = true;
      return;
    }
    if (!signal.aborted) {
      this.waiting += 1;
      signal.addEventListener(
        'abort',
        () => {
          this.waiting -= 1;
          this.abandonIfNobodyWaits();
        },
        { once: true }
      );
    }
    this.abandonIfNobodyWaits();
  }

  commit(): void {
    this.committed = true;
  }

  private abandonIfNobodyWaits(): void {
    if (this.committed || this.hasCallerWithoutSignal || this.waiting > 0) {
      return;
    }
    if (this.controller.signal.aborted) return;
    this.onAbandoned();
    this.controller.abort();
  }
}

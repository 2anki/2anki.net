// Caps how many of an expensive operation run on this process at once. Each
// PDF preview launches a fresh Chrome, so a burst of them would exhaust memory
// before any per-IP or per-user window noticed; this bounds the in-flight set.
export class ConcurrencyLimiter {
  private active = 0;

  constructor(private readonly max: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.max) {
      return false;
    }
    this.active += 1;
    return true;
  }

  release(): void {
    if (this.active > 0) {
      this.active -= 1;
    }
  }

  get inFlight(): number {
    return this.active;
  }
}

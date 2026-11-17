export class WaitAbandonedError extends Error {
  constructor() {
    super('The caller stopped waiting.');
    this.name = 'WaitAbandonedError';
  }
}

interface Waiter {
  weight: number;
  grant: (release: () => void) => void;
}

// Bounds the total weight of work running at once. Waiters are served in
// arrival order, so a heavy request is never starved by lighter ones behind
// it, and one request always runs even when it outweighs the capacity alone.
export class WeightedSemaphore {
  private used = 0;
  private running = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly capacity: number) {}

  get inUse(): number {
    return this.used;
  }

  get waiting(): number {
    return this.queue.length;
  }

  wouldWait(weight: number): boolean {
    return this.queue.length > 0 || !this.fits(weight);
  }

  acquire(weight: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new WaitAbandonedError());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { weight, grant: resolve };
      this.queue.push(waiter);
      if (signal != null) {
        const abandon = () => {
          const index = this.queue.indexOf(waiter);
          if (index === -1) return;
          this.queue.splice(index, 1);
          reject(new WaitAbandonedError());
          this.drain();
        };
        signal.addEventListener('abort', abandon, { once: true });
        waiter.grant = (release) => {
          signal.removeEventListener('abort', abandon);
          resolve(release);
        };
      }
      this.drain();
    });
  }

  private fits(weight: number): boolean {
    return this.running === 0 || this.used + weight <= this.capacity;
  }

  private drain(): void {
    while (this.queue.length > 0 && this.fits(this.queue[0].weight)) {
      const waiter = this.queue.shift() as Waiter;
      this.used += waiter.weight;
      this.running += 1;
      waiter.grant(this.releaserFor(waiter.weight));
    }
  }

  private releaserFor(weight: number): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.used -= weight;
      this.running -= 1;
      this.drain();
    };
  }
}

interface BudgetEntry {
  bytes: number;
  evict: () => void;
}

// One byte budget shared by every preview cache in the process. Each cache
// keeps its own entries; the budget only tracks their estimated size in
// least-recently-used order and tells the owning cache when to drop one.
export class ParseCacheBudget {
  private readonly entries = new Map<object, BudgetEntry>();
  private total = 0;

  constructor(readonly limitBytes: number) {}

  get totalBytes(): number {
    return this.total;
  }

  admit(token: object, bytes: number, evict: () => void): boolean {
    if (bytes > this.limitBytes) return false;
    this.forget(token);
    this.entries.set(token, { bytes, evict });
    this.total += bytes;
    this.evictUntilWithinLimit();
    return true;
  }

  touch(token: object): void {
    const entry = this.entries.get(token);
    if (entry == null) return;
    this.entries.delete(token);
    this.entries.set(token, entry);
  }

  forget(token: object): void {
    const entry = this.entries.get(token);
    if (entry == null) return;
    this.entries.delete(token);
    this.total -= entry.bytes;
  }

  private evictUntilWithinLimit(): void {
    while (this.total > this.limitBytes) {
      const oldest = this.entries.entries().next().value;
      if (oldest == null) return;
      const [token, entry] = oldest;
      this.forget(token);
      entry.evict();
    }
  }
}

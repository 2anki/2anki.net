import { vi } from 'vitest';

import { ParseCacheBudget } from './ParseCacheBudget';

describe('ParseCacheBudget', () => {
  it('keeps entries while their total stays within the budget', () => {
    const budget = new ParseCacheBudget(100);
    const evict = vi.fn();

    expect(budget.admit({}, 40, evict)).toBe(true);
    expect(budget.admit({}, 60, evict)).toBe(true);

    expect(budget.totalBytes).toBe(100);
    expect(evict).not.toHaveBeenCalled();
  });

  it('evicts the least recently used entries once the total passes the budget', () => {
    const budget = new ParseCacheBudget(100);
    const order: string[] = [];
    const a = {};
    const b = {};
    budget.admit(a, 40, () => order.push('a'));
    budget.admit(b, 40, () => order.push('b'));
    budget.touch(a);

    budget.admit({}, 40, () => order.push('c'));

    expect(order).toEqual(['b']);
    expect(budget.totalBytes).toBe(80);
  });

  it('evicts as many entries as it takes to fit a new one', () => {
    const budget = new ParseCacheBudget(100);
    const order: string[] = [];
    budget.admit({}, 30, () => order.push('a'));
    budget.admit({}, 30, () => order.push('b'));
    budget.admit({}, 30, () => order.push('c'));

    budget.admit({}, 90, () => order.push('d'));

    expect(order).toEqual(['a', 'b', 'c']);
    expect(budget.totalBytes).toBe(90);
  });

  it('declines an entry larger than the whole budget and evicts nothing', () => {
    const budget = new ParseCacheBudget(100);
    const evict = vi.fn();
    budget.admit({}, 50, evict);

    expect(budget.admit({}, 101, evict)).toBe(false);

    expect(budget.totalBytes).toBe(50);
    expect(evict).not.toHaveBeenCalled();
  });

  it('stops counting an entry its cache dropped', () => {
    const budget = new ParseCacheBudget(100);
    const entry = {};
    const evict = vi.fn();
    budget.admit(entry, 70, evict);

    budget.forget(entry);
    budget.admit({}, 70, vi.fn());

    expect(budget.totalBytes).toBe(70);
    expect(evict).not.toHaveBeenCalled();
  });

  it('counts one budget across every cache that admits into it', () => {
    const budget = new ParseCacheBudget(100);
    const evictedFromFirstCache = vi.fn();
    budget.admit({}, 60, evictedFromFirstCache);

    budget.admit({}, 60, vi.fn());

    expect(evictedFromFirstCache).toHaveBeenCalledTimes(1);
  });
});

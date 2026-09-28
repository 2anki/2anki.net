import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePricingOrderVariant } from './usePricingOrderVariant';

function stubRandomByte(value: number) {
  return vi
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView<ArrayBuffer>>(array: T) => {
      if (array instanceof Uint8Array) array[0] = value;
      return array;
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('usePricingOrderVariant', () => {
  it('buckets a new visitor into minimal on an even draw and persists it', () => {
    stubRandomByte(0);
    const { result } = renderHook(() => usePricingOrderVariant());
    expect(result.current).toBe('minimal');
    expect(localStorage.getItem('pricing_order_variant')).toBe('minimal');
  });

  it('buckets a new visitor into semester-first on an odd draw and persists it', () => {
    stubRandomByte(1);
    const { result } = renderHook(() => usePricingOrderVariant());
    expect(result.current).toBe('semester-first');
    expect(localStorage.getItem('pricing_order_variant')).toBe(
      'semester-first'
    );
  });

  it('keeps a returning visitor in their stored bucket', () => {
    localStorage.setItem('pricing_order_variant', 'semester-first');
    const random = stubRandomByte(0);
    const { result } = renderHook(() => usePricingOrderVariant());
    expect(result.current).toBe('semester-first');
    expect(random).not.toHaveBeenCalled();
  });

  it('reassigns a visitor still holding a label from the concluded order test', () => {
    localStorage.setItem('pricing_order_variant', 'unlimited-first');
    stubRandomByte(0);
    const { result } = renderHook(() => usePricingOrderVariant());
    expect(result.current).toBe('minimal');
    expect(localStorage.getItem('pricing_order_variant')).toBe('minimal');
  });

  it('honours the ?variant= preview override without persisting it', () => {
    window.history.pushState({}, '', '/?variant=semester-first');
    const random = stubRandomByte(0);
    const { result } = renderHook(() => usePricingOrderVariant());
    expect(result.current).toBe('semester-first');
    expect(localStorage.getItem('pricing_order_variant')).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it('ignores an unknown ?variant= value and buckets normally', () => {
    window.history.pushState({}, '', '/?variant=hacker');
    stubRandomByte(1);
    const { result } = renderHook(() => usePricingOrderVariant());
    expect(result.current).toBe('semester-first');
  });
});

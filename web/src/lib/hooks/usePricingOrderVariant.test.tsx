import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePricingOrderVariant } from './usePricingOrderVariant';

describe('usePricingOrderVariant', () => {
  it('puts the Semester Pass first for every visitor', () => {
    const { result } = renderHook(() => usePricingOrderVariant());
    expect(result.current).toBe('semester-first');
  });

  it('ignores a stored bucket from the concluded test', () => {
    localStorage.setItem('pricing_order_variant', 'minimal');
    const { result } = renderHook(() => usePricingOrderVariant());
    expect(result.current).toBe('semester-first');
    localStorage.clear();
  });
});

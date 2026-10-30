import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { usePricingOrderVariant } from './usePricingOrderVariant';

const renderAt = (path: string) =>
  renderHook(() => usePricingOrderVariant(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    ),
  });

describe('usePricingOrderVariant', () => {
  it('puts the Semester Pass first for a visitor without a connector ref', () => {
    const { result } = renderAt('/pricing');
    expect(result.current).toBe('semester-first');
  });

  it('ignores a stored bucket from the concluded test', () => {
    localStorage.setItem('pricing_order_variant', 'minimal');
    const { result } = renderAt('/pricing');
    expect(result.current).toBe('semester-first');
    localStorage.clear();
  });

  it.each(['/pricing?ref=mcp', '/pricing?ref=MCP'])(
    'puts the Day Pass first for a connector visitor at %s',
    (path) => {
      const { result } = renderAt(path);
      expect(result.current).toBe('mcp-day-first');
    }
  );

  it('keeps the default order for any other ref', () => {
    const { result } = renderAt('/pricing?ref=other');
    expect(result.current).toBe('semester-first');
  });
});

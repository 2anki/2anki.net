import { describe, expect, it } from 'vitest';
import { OPS_TABS } from './opsTabs';

describe('OPS_TABS', () => {
  it('lists the seven consolidated rows in order', () => {
    expect(OPS_TABS.map((tab) => tab.label)).toEqual([
      'Today',
      'Growth',
      'Business',
      'System',
      'Errors',
      'Messages',
      'Commands',
    ]);
  });

  it('points each row at its consolidated route', () => {
    expect(OPS_TABS.map((tab) => tab.to)).toEqual([
      '/ops/today',
      '/ops/growth',
      '/ops/business',
      '/ops/system',
      '/ops/errors',
      '/ops/messages',
      '/ops/commands',
    ]);
  });

  it('does not list routes that now redirect', () => {
    const paths = OPS_TABS.map((tab) => tab.to);
    for (const redirected of [
      '/ops/conversions',
      '/ops/upload-funnel',
      '/ops/return-rate',
      '/ops/performance',
      '/ops/flags',
      '/ops/showcase',
    ]) {
      expect(paths).not.toContain(redirected);
    }
  });

  it('does not list the retired or unlisted rows', () => {
    const paths = OPS_TABS.map((tab) => tab.to);
    expect(paths).not.toContain('/ops/mindmaps');
    expect(paths).not.toContain('/ops/pricing-ab');
    expect(paths).not.toContain('/ops/interviews');
    expect(paths).not.toContain('/ops/engineering');
  });

  it('has a unique route for every tab', () => {
    const paths = OPS_TABS.map((tab) => tab.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('matches the Today row on /ops, /ops/today, and query strings, not other children', () => {
    const today = OPS_TABS.find((tab) => tab.to === '/ops/today');
    expect(today?.match('/ops')).toBe(true);
    expect(today?.match('/ops/today')).toBe(true);
    expect(today?.match('/ops?window=7d')).toBe(true);
    expect(today?.match('/ops/errors')).toBe(false);
    expect(today?.match('/ops/system')).toBe(false);
  });

  it('matches the System row only on its own route', () => {
    const system = OPS_TABS.find((tab) => tab.to === '/ops/system');
    expect(system?.match('/ops/system')).toBe(true);
    expect(system?.match('/ops')).toBe(false);
  });

  it('matches a child row only on its own route', () => {
    const growth = OPS_TABS.find((tab) => tab.to === '/ops/growth');
    expect(growth?.match('/ops/growth')).toBe(true);
    expect(growth?.match('/ops')).toBe(false);
    expect(growth?.match('/ops/today')).toBe(false);
  });
});

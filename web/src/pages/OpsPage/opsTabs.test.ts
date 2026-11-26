import { describe, expect, it } from 'vitest';
import { OPS_MAIN_TABS, OPS_MORE_TABS, OPS_TABS } from './opsTabs';

describe('OPS_TABS', () => {
  it('lists the four everyday rows first, then the rest', () => {
    expect(OPS_TABS.map((tab) => tab.label)).toEqual([
      'Today',
      'Business',
      'Growth',
      'Flags',
      'System',
      'Errors',
      'Messages',
      'Tools',
      'Showcase',
    ]);
  });

  it('points each row at its consolidated route', () => {
    expect(OPS_TABS.map((tab) => tab.to)).toEqual([
      '/ops/today',
      '/ops/business',
      '/ops/growth',
      '/ops/flags',
      '/ops/system',
      '/ops/errors',
      '/ops/messages',
      '/ops/tools',
      '/ops/showcase',
    ]);
  });

  it('does not list routes that now redirect', () => {
    const paths = OPS_TABS.map((tab) => tab.to);
    for (const redirected of [
      '/ops/conversions',
      '/ops/upload-funnel',
      '/ops/return-rate',
      '/ops/performance',
      '/ops/commands',
      '/ops/users',
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

  it('shows four rows up front and keeps the rest under More', () => {
    expect(OPS_MAIN_TABS.map((tab) => tab.label)).toEqual([
      'Today',
      'Business',
      'Growth',
      'Flags',
    ]);
    expect(OPS_MORE_TABS.map((tab) => tab.label)).toEqual([
      'System',
      'Errors',
      'Messages',
      'Tools',
      'Showcase',
    ]);
  });

  it('matches each split command page only on its own route', () => {
    for (const path of ['/ops/tools', '/ops/flags', '/ops/showcase']) {
      const matching = OPS_TABS.filter((tab) => tab.match(path));
      expect(matching.map((tab) => tab.to)).toEqual([path]);
    }
  });

  it('keeps Tools active on the old Commands and Users addresses', () => {
    for (const path of ['/ops/commands', '/ops/users']) {
      const matching = OPS_TABS.filter((tab) => tab.match(path));
      expect(matching.map((tab) => tab.to)).toEqual(['/ops/tools']);
    }
  });

  it('matches a child row only on its own route', () => {
    const growth = OPS_TABS.find((tab) => tab.to === '/ops/growth');
    expect(growth?.match('/ops/growth')).toBe(true);
    expect(growth?.match('/ops')).toBe(false);
    expect(growth?.match('/ops/today')).toBe(false);
  });
});

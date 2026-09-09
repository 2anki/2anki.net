import {
  FAILED_PAYMENTS_SPIKE_MULTIPLIER,
  MONITOR_WINDOW_DAYS,
  RED_MISS_RATIO,
  TODAY_SNAPSHOT_TTL_MS,
  TODAY_TARGETS,
} from './todayThresholds';

describe('todayThresholds', () => {
  it('gives every target exactly one direction', () => {
    for (const [id, target] of Object.entries(TODAY_TARGETS)) {
      const directions = ['at_least' in target, 'at_most' in target].filter(
        Boolean
      );
      expect({ id, directions: directions.length }).toEqual({
        id,
        directions: 1,
      });
    }
  });

  it('keeps the CLAUDE.md targets for new paid and conversion success', () => {
    expect(TODAY_TARGETS.new_paid_7d).toEqual({ at_least: 70 });
    expect(TODAY_TARGETS.conversion_success_7d_pct).toEqual({ at_least: 90 });
  });

  it('treats revenue leaks as zero-tolerance and no-deck paid users as amber', () => {
    expect(TODAY_TARGETS.missing_pass_unlocks_7d).toEqual({ at_most: 0 });
    expect(TODAY_TARGETS.unresolved_error_groups).toEqual({ at_most: 0 });
    expect(TODAY_TARGETS.zero_value_paid_7d).toEqual({
      at_most: 0,
      missedSeverity: 'amber',
    });
  });

  it('pins the tuning constants', () => {
    expect(FAILED_PAYMENTS_SPIKE_MULTIPLIER).toBe(2);
    expect(RED_MISS_RATIO).toBe(0.25);
    expect(TODAY_SNAPSHOT_TTL_MS).toBe(5 * 60 * 1000);
    expect(MONITOR_WINDOW_DAYS).toBe(7);
  });
});

import {
  PASS_DURATION_MS,
  isAnonymousPassKind,
} from '../../../usecases/passes/passDurations';

export interface ActivePassRow {
  kind: string;
  expiresAt: Date;
}

export interface ActivePassWindow {
  kind: string;
  windowStart: Date;
  windowEnd: Date;
}

// The plan (credits, and whether it is an Apple unlimited pass) follows the
// latest-expiring active row. The spend window is anchored on the earliest
// purchase across ALL active rows — `expiresAt − duration` for every anonymous
// pass, including a different kind stacked on top — so a stacked or mixed pass
// never pushes the window into the future where earlier spend stops counting.
// The anchor is clamped to now so a freshly stacked set never starts ahead of
// the clock.
export function pickActivePassWindow(
  rows: ActivePassRow[],
  now: Date
): ActivePassWindow | null {
  if (rows.length === 0) {
    return null;
  }
  let relevant = rows[0];
  for (const row of rows) {
    if (row.expiresAt.getTime() > relevant.expiresAt.getTime()) {
      relevant = row;
    }
  }
  const windowEnd = relevant.expiresAt;
  let earliest = windowEnd.getTime();
  for (const row of rows) {
    if (isAnonymousPassKind(row.kind)) {
      const start = row.expiresAt.getTime() - PASS_DURATION_MS[row.kind];
      earliest = Math.min(earliest, start);
    }
  }
  const windowStart = new Date(Math.min(earliest, now.getTime()));
  return { kind: relevant.kind, windowStart, windowEnd };
}

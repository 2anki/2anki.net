export interface ActivePassRow {
  kind: string;
  expiresAt: Date;
}

export interface ActivePassWindow {
  kind: string;
  earliestExpiresAt: Date;
  latestExpiresAt: Date;
}

// The pass that decides the plan is the latest-expiring active row (matching
// findActive); its earliest still-active sibling of the same kind anchors the
// credit window on purchase time so stacking never resets the balance.
export function pickActivePassWindow(
  rows: ActivePassRow[]
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
  const sameKind = rows.filter((row) => row.kind === relevant.kind);
  const expiries = sameKind.map((row) => row.expiresAt.getTime());
  return {
    kind: relevant.kind,
    earliestExpiresAt: new Date(Math.min(...expiries)),
    latestExpiresAt: new Date(Math.max(...expiries)),
  };
}

const LISTED_COLUMNS_MAX = 5;

function quoted(names: string[]): string[] {
  return names.map((name) => `"${name}"`);
}

function joinNames(names: string[], conjunction: 'and' | 'or'): string {
  const items = quoted(names);
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

// The downloads page only shows a reason that stays short, so a wide
// database lists its first few columns and counts the rest.
function availableColumns(columns: string[]): string {
  if (columns.length <= LISTED_COLUMNS_MAX) return joinNames(columns, 'and');
  const shown = quoted(columns.slice(0, LISTED_COLUMNS_MAX)).join(', ');
  return `${shown}, and ${columns.length - LISTED_COLUMNS_MAX} more`;
}

// Column names come from the first row, so an empty list means the database
// has no rows yet, not that it lacks columns.
export function notionDatabaseColumnsReason(
  columns: string[],
  requested?: { frontField?: string; backField?: string }
): string {
  if (columns.length === 0) {
    return 'This database has no rows yet. Add a row with a front and a back column filled in, then convert again.';
  }
  if (columns.length === 1) {
    return `This database has only one column, "${columns[0]}". Cards need a front and a back column. Add a text column for the back, fill it in, then convert again.`;
  }
  const missing = [requested?.frontField, requested?.backField].filter(
    (name): name is string => name != null && !columns.includes(name)
  );
  if (missing.length > 0) {
    const noun = missing.length === 1 ? 'no column named' : 'no columns named';
    return `This database has ${noun} ${joinNames(missing, 'or')}. It has ${availableColumns(columns)}. Pick columns it has for the front and the back, then convert again.`;
  }
  return `Cards need a front and a back column. This database has ${availableColumns(columns)}. Pick one for each, then convert again.`;
}

export class NotionDatabaseColumnsError extends Error {
  readonly columns: string[];

  constructor(
    columns: string[],
    requested?: { frontField?: string; backField?: string }
  ) {
    super(notionDatabaseColumnsReason(columns, requested));
    this.name = 'NotionDatabaseColumnsError';
    this.columns = columns;
  }
}

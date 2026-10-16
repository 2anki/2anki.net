function listColumns(columns: string[]): string {
  return columns.join(', ');
}

// The reason the job stores and the downloads page shows, so it reads as
// copy: what the database has, and what to add before converting again.
export function notionDatabaseColumnsReason(
  columns: string[],
  requested?: { frontField?: string; backField?: string }
): string {
  const missing = [requested?.frontField, requested?.backField].filter(
    (name): name is string => name != null && !columns.includes(name)
  );
  if (missing.length > 0 && columns.length > 0) {
    return `This database has no column named ${listColumns(missing)}. It has: ${listColumns(columns)}. Pick a column that exists for the front and the back, then convert again.`;
  }
  if (columns.length === 0) {
    return 'This database has no columns we can read. Cards need a front and a back column. Add two text columns, fill them in, then convert again.';
  }
  return `This database has only one column, ${columns[0]}. Cards need a front and a back column. Add a text column for the back, fill it in, then convert again.`;
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

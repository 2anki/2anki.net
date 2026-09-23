// Minimal RFC-4180 CSV parser for the SendGrid suppression exports
// (bounces, blocks, spam reports). Header row: status,reason,email,created.
// The reason column is quoted and can contain commas, double quotes ("" escape)
// and newlines, which rules out a naive line split.

export interface BounceExportRow {
  status: string;
  reason: string;
  email: string;
  /** Unix epoch seconds from SendGrid's `created` column. */
  created: number;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      pushField();
      i++;
      continue;
    }
    if (char === '\r') {
      i++;
      continue;
    }
    if (char === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows;
}

export interface ParsedBounceExport {
  rows: BounceExportRow[];
  skipped: number;
}

export function parseBounceExport(text: string): ParsedBounceExport {
  const raw = parseCsv(text);
  if (raw.length === 0) {
    return { rows: [], skipped: 0 };
  }

  const header = raw[0].map((column) => column.trim().toLowerCase());
  const emailIndex = header.indexOf('email');
  const createdIndex = header.indexOf('created');
  const statusIndex = header.indexOf('status');
  const reasonIndex = header.indexOf('reason');
  if (emailIndex === -1 || createdIndex === -1) {
    throw new Error(
      'Not a SendGrid suppression export: missing email/created columns'
    );
  }

  const rows: BounceExportRow[] = [];
  let skipped = 0;
  for (const cells of raw.slice(1)) {
    const email = (cells[emailIndex] ?? '').trim().toLowerCase();
    const created = Number.parseInt(cells[createdIndex] ?? '', 10);
    if (!email.includes('@') || !Number.isFinite(created) || created <= 0) {
      skipped++;
      continue;
    }
    rows.push({
      status: (cells[statusIndex] ?? '').trim(),
      reason: (cells[reasonIndex] ?? '').trim(),
      email,
      created,
    });
  }
  return { rows, skipped };
}

const LEADING_NUMBERING = /^\s*\d+\s*[.)\-–](?!\d)\s*/;

export function stripLeadingDeckNumbering(name: string): string {
  const stripped = name.replace(LEADING_NUMBERING, '');
  return stripped.trim().length > 0 ? stripped : name;
}

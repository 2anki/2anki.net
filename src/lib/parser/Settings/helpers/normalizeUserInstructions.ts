import { getDefaultUserInstructions } from '../../../../infrastracture/adapters/fileConversion/convertPDFToHTML';

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeUserInstructions(
  raw: string | undefined
): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (
    collapseWhitespace(trimmed) ===
    collapseWhitespace(getDefaultUserInstructions())
  ) {
    return undefined;
  }
  return trimmed;
}

// The connector saves a whole deck for a plan only from one text source it
// sent itself, so the claim rebuilds exactly what was asked for. Documents,
// spreadsheets, slides, archives and images keep today's refusal.
const TEXT_SOURCE_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'csv',
  'tsv',
  'html',
  'htm',
]);

export function isConnectorPlanHoldEligible(
  files: { originalname: string }[] | undefined
): boolean {
  if (files == null || files.length !== 1) {
    return false;
  }
  const name = files[0].originalname.toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 && TEXT_SOURCE_EXTENSIONS.has(name.slice(dot + 1));
}

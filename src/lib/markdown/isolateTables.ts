const TABLE_DELIMITER_RE = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;

const isBlank = (line: string): boolean => line.trim() === '';

export const isolateTablesFromText = (markdown: string): string => {
  const lines = markdown.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const delimiter = lines[i + 1];
    const preceding = out.length > 0 ? out[out.length - 1] : undefined;
    const tableGluedToText =
      delimiter !== undefined &&
      TABLE_DELIMITER_RE.test(delimiter) &&
      header.includes('|') &&
      preceding !== undefined &&
      !isBlank(preceding) &&
      !TABLE_DELIMITER_RE.test(preceding);
    if (tableGluedToText) {
      out.push('');
    }
    out.push(header);
  }
  return out.join('\n');
};

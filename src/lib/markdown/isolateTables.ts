const CODE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_CELL_RE = /^:?-+:?$/;

const isTableDelimiter = (line: string): boolean => {
  if (!line.includes('|') || !line.includes('-')) {
    return false;
  }
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  if (body === '') {
    return false;
  }
  return body.split('|').every((cell) => DELIMITER_CELL_RE.test(cell.trim()));
};

const isIndented = (line: string): boolean => /^[ \t]/.test(line);

const isBlank = (line: string): boolean => line.trim() === '';

export const isolateTablesFromText = (markdown: string): string => {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let openFence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = CODE_FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (openFence == null) {
        openFence = marker;
      } else if (openFence === marker) {
        openFence = null;
      }
      out.push(line);
      continue;
    }
    if (openFence != null) {
      out.push(line);
      continue;
    }
    const nextLine = lines[i + 1];
    const preceding = out.length > 0 ? out[out.length - 1] : undefined;
    const tableGluedToText =
      !isIndented(line) &&
      line.includes('|') &&
      nextLine !== undefined &&
      isTableDelimiter(nextLine) &&
      preceding !== undefined &&
      !isBlank(preceding) &&
      !isTableDelimiter(preceding);
    if (tableGluedToText) {
      out.push('');
    }
    out.push(line);
  }
  return out.join('\n');
};

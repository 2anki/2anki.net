import MarkdownIt from 'markdown-it';

const VERBATIM_TOKEN_TYPES = new Set(['fence', 'code_block', 'html_block']);
const DELIMITER_CELL_RE = /^:?-+:?$/;

const rangeParser = new MarkdownIt({ html: false });

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

const verbatimLineSet = (markdown: string): Set<number> => {
  const verbatim = new Set<number>();
  for (const token of rangeParser.parse(markdown, {})) {
    if (VERBATIM_TOKEN_TYPES.has(token.type) && token.map != null) {
      for (let line = token.map[0]; line < token.map[1]; line++) {
        verbatim.add(line);
      }
    }
  }
  return verbatim;
};

export const isolateTablesFromText = (markdown: string): string => {
  const verbatim = verbatimLineSet(markdown);
  const lines = markdown.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    const preceding = out.length > 0 ? out[out.length - 1] : undefined;
    const tableGluedToText =
      !verbatim.has(i) &&
      !verbatim.has(i + 1) &&
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

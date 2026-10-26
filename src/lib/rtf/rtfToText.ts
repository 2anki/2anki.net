// Plain text out of an RTF file, read in-process. RTF can link pictures and
// fields to local paths or URLs, so it is never handed to a converter that
// might follow them: linked and embedded objects are dropped here unread.
const SKIPPED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'objdata',
  'fldinst',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'xmlnstbl',
  'pgdsctbl',
  'mmathPr',
]);

const WINDOWS_1252 = new TextDecoder('windows-1252');

const LIST_MARKER = /^[\u2022\u00b7\u25aa\u25cf\u25e6\u2043\u2013]\s*/;
// A list level in TextEdit and Word is 720 twips (half an inch) of indent.
const TWIPS_PER_LEVEL = 720;

interface Group {
  skip: boolean;
  unicodeSkip: number;
}

function decodeHexByte(hex: string): string {
  return WINDOWS_1252.decode(Uint8Array.of(Number.parseInt(hex, 16)));
}

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

// List lines keep their nesting as markdown; other lines lose stray indent.
function toMarkdownLine(line: string): string {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
  const rest = line.slice(leading.length).trimEnd();
  if (!LIST_MARKER.test(rest)) return rest;
  return `${leading.replace(/\t/g, '')}${rest.replace(LIST_MARKER, '- ')}`;
}

// Real documents nest a few dozen groups deep; deeper groups are read as
// part of their parent so a crafted file cannot grow the stack without end.
const MAX_GROUP_DEPTH = 256;
const MAX_CODE_POINT = 0x10ffff;
const MAX_LIST_LEVEL = 8;
const PLAIN_RUN = /[^\\{}\r\n]+/y;

export function rtfToText(rtf: string): string {
  const out: string[] = [];
  const stack: Group[] = [];
  let group: Group = { skip: false, unicodeSkip: 1 };
  let flattenedDepth = 0;
  let pendingSkip = 0;
  let i = 0;

  const emit = (text: string) => {
    if (group.skip) return;
    if (pendingSkip > 0) {
      pendingSkip -= 1;
      return;
    }
    out.push(text);
  };
  // A run of plain characters: the first pendingSkip of them are the \\uN
  // fallback text and are dropped.
  const emitRun = (run: string) => {
    if (group.skip) return;
    const dropped = Math.min(pendingSkip, run.length);
    pendingSkip -= dropped;
    if (dropped < run.length) out.push(run.slice(dropped));
  };

  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') {
      if (stack.length < MAX_GROUP_DEPTH) {
        stack.push(group);
        group = { ...group };
      } else {
        flattenedDepth += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (flattenedDepth > 0) {
        flattenedDepth -= 1;
      } else {
        group = stack.pop() ?? { skip: false, unicodeSkip: 1 };
      }
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }
    if (ch !== '\\') {
      PLAIN_RUN.lastIndex = i;
      const run = PLAIN_RUN.exec(rtf)?.[0] ?? ch;
      emitRun(run);
      i += run.length;
      continue;
    }

    const next = rtf[i + 1];
    if (next === '\\' || next === '{' || next === '}') {
      emit(next);
      i += 2;
      continue;
    }
    if (next === "'") {
      const hex = rtf.slice(i + 2, i + 4);
      if (HEX_PAIR.test(hex)) {
        emit(decodeHexByte(hex));
        i += 4;
      } else {
        i += 2;
      }
      continue;
    }
    if (next === '*') {
      group.skip = true;
      i += 2;
      continue;
    }
    if (next === '~') {
      emit(' ');
      i += 2;
      continue;
    }
    if (next === '_') {
      emit('-');
      i += 2;
      continue;
    }
    if (next === '\r' || next === '\n') {
      emit('\n');
      i += 2;
      continue;
    }

    const match = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
    if (match == null) {
      i += 2;
      continue;
    }
    i += 1 + match[0].length;
    const word = match[1];
    const param = match[2] == null ? null : Number(match[2]);

    if (SKIPPED_DESTINATIONS.has(word)) {
      group.skip = true;
    } else if (word === 'li' && param != null && param > 0) {
      const atLineStart = out.length === 0 || out[out.length - 1] === '\n';
      if (atLineStart && !group.skip) {
        const level = Math.min(
          Math.round(param / TWIPS_PER_LEVEL),
          MAX_LIST_LEVEL
        );
        out.push('  '.repeat(level));
      }
    } else if (word === 'par' || word === 'line' || word === 'sect') {
      emit('\n');
    } else if (word === 'tab') {
      emit('\t');
    } else if (word === 'bullet') {
      emit('•');
    } else if (word === 'emdash' || word === 'endash') {
      emit('-');
    } else if (word === 'lquote' || word === 'rquote') {
      emit("'");
    } else if (word === 'ldblquote' || word === 'rdblquote') {
      emit('"');
    } else if (word === 'uc' && param != null) {
      group.unicodeSkip = Math.min(Math.max(param, 0), 16);
    } else if (word === 'u' && param != null) {
      const codePoint = param < 0 ? param + 65536 : param;
      emit(
        codePoint >= 0 && codePoint <= MAX_CODE_POINT
          ? String.fromCodePoint(codePoint)
          : '\ufffd'
      );
      pendingSkip = group.unicodeSkip;
    }
  }

  const lines = out.join('').split('\n').map(toMarkdownLine);
  // Top-level items are often indented too; nesting is relative to them.
  const listIndents = lines
    .filter((line) => /^ *- /.test(line))
    .map((line) => line.length - line.trimStart().length);
  const base = listIndents.reduce(
    (lowest, indent) => Math.min(lowest, indent),
    listIndents.length > 0 ? Number.POSITIVE_INFINITY : 0
  );
  return lines
    .map((line) => (/^ *- /.test(line) ? line.slice(base) : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

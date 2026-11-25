// A linear reader over the tags of one OOXML part, for deciding where a long
// Word body may be split. It reads each character at most a fixed number of
// times, holds no backtracking pattern, and throws UnreadableDocument on
// anything it does not fully understand so the caller converts the file whole.
export class UnreadableDocument extends Error {}

export type TagKind = 'open' | 'close' | 'empty';

const LESS_THAN = 0x3c;
const GREATER_THAN = 0x3e;
const SLASH = 0x2f;
const EQUALS = 0x3d;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;
const AMPERSAND = 0x26;
const DEADLINE_CHECK_INTERVAL = 4096;

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isNameEnd(code: number): boolean {
  return isSpace(code) || code === SLASH || code === GREATER_THAN;
}

const MARKUP: [string, string][] = [
  ['<!--', '-->'],
  ['<![CDATA[', ']]>'],
  ['<?', '?>'],
];

export class XmlTagReader {
  kind: TagKind = 'open';

  name = '';

  start = 0;

  end = 0;

  private cursor: number;

  private nameEnd = 0;

  private tagsRead = 0;

  constructor(
    private readonly xml: string,
    from: number,
    private readonly to: number,
    private readonly deadline: number
  ) {
    this.cursor = from;
  }

  next(): boolean {
    for (;;) {
      const open = this.xml.indexOf('<', this.cursor);
      if (open === -1 || open >= this.to) return false;
      const markupEnd = this.skipMarkup(open);
      if (markupEnd != null) {
        this.cursor = markupEnd;
        continue;
      }
      this.readTag(open);
      this.tagsRead += 1;
      if (
        this.tagsRead % DEADLINE_CHECK_INTERVAL === 0 &&
        Date.now() > this.deadline
      ) {
        throw new UnreadableDocument();
      }
      return true;
    }
  }

  textFollows(): boolean {
    const next = this.end + 1;
    return next < this.to && this.xml.charCodeAt(next) !== LESS_THAN;
  }

  declaresNamespace(): boolean {
    return this.xml.substring(this.start, this.end).includes('xmlns');
  }

  attribute(wanted: string): string | undefined {
    let found: string | undefined;
    this.forEachAttribute((attributeName, value) => {
      if (attributeName === wanted && found === undefined) found = value;
    });
    if (found !== undefined && found.includes('&')) {
      throw new UnreadableDocument();
    }
    return found;
  }

  forEachAttribute(visit: (name: string, value: string) => void): void {
    const xml = this.xml;
    const stop = this.kind === 'empty' ? this.end - 1 : this.end;
    let at = this.nameEnd;
    for (;;) {
      while (at < stop && isSpace(xml.charCodeAt(at))) at += 1;
      if (at >= stop) return;
      const nameStart = at;
      while (at < stop) {
        const code = xml.charCodeAt(at);
        if (isSpace(code) || code === EQUALS) break;
        if (code === SLASH || code === GREATER_THAN || code === LESS_THAN) {
          throw new UnreadableDocument();
        }
        at += 1;
      }
      const attributeName = xml.slice(nameStart, at);
      while (at < stop && isSpace(xml.charCodeAt(at))) at += 1;
      if (attributeName === '' || xml.charCodeAt(at) !== EQUALS) {
        throw new UnreadableDocument();
      }
      at += 1;
      while (at < stop && isSpace(xml.charCodeAt(at))) at += 1;
      const quote = xml.charCodeAt(at);
      if (quote !== DOUBLE_QUOTE && quote !== SINGLE_QUOTE) {
        throw new UnreadableDocument();
      }
      const valueEnd = xml.indexOf(String.fromCharCode(quote), at + 1);
      if (valueEnd === -1 || valueEnd >= stop) throw new UnreadableDocument();
      const value = xml.slice(at + 1, valueEnd);
      if (value.includes('<')) throw new UnreadableDocument();
      visit(attributeName, value);
      at = valueEnd + 1;
      if (at < stop && !isSpace(xml.charCodeAt(at))) {
        throw new UnreadableDocument();
      }
    }
  }

  private skipMarkup(at: number): number | null {
    if (
      this.xml.charCodeAt(at + 1) !== 0x21 &&
      this.xml.charCodeAt(at + 1) !== 0x3f
    ) {
      return null;
    }
    for (const [open, close] of MARKUP) {
      if (!this.xml.startsWith(open, at)) continue;
      const end = this.xml.indexOf(close, at + open.length);
      if (end === -1 || end >= this.to) throw new UnreadableDocument();
      return end + close.length;
    }
    throw new UnreadableDocument();
  }

  private readTag(open: number): void {
    const xml = this.xml;
    const closing = xml.charCodeAt(open + 1) === SLASH;
    const nameStart = closing ? open + 2 : open + 1;
    let at = nameStart;
    while (at < this.to && !isNameEnd(xml.charCodeAt(at))) {
      if (
        xml.charCodeAt(at) === LESS_THAN ||
        xml.charCodeAt(at) === AMPERSAND
      ) {
        throw new UnreadableDocument();
      }
      at += 1;
    }
    if (at === nameStart || at >= this.to) throw new UnreadableDocument();
    this.name = xml.slice(nameStart, at);
    this.nameEnd = at;
    let quote = 0;
    for (; at < this.to; at++) {
      const code = xml.charCodeAt(at);
      if (quote !== 0) {
        if (code === quote) quote = 0;
      } else if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE) {
        quote = code;
      } else if (code === LESS_THAN) {
        throw new UnreadableDocument();
      } else if (code === GREATER_THAN) {
        break;
      }
    }
    if (at >= this.to) throw new UnreadableDocument();
    this.start = open;
    this.end = at;
    this.cursor = at + 1;
    if (closing) {
      this.kind = 'close';
      for (let i = this.nameEnd; i < at; i++) {
        if (!isSpace(xml.charCodeAt(i))) throw new UnreadableDocument();
      }
    } else {
      this.kind = xml.charCodeAt(at - 1) === SLASH ? 'empty' : 'open';
    }
  }
}

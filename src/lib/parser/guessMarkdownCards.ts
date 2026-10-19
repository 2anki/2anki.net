import Note from './Note';
import { markdownToHTML } from '../markdown';

function tryDetailsPattern(content: string): Note[] {
  const regex =
    /<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  const notes: Note[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const front = match[1].trim();
    const back = match[2].trim();
    if (front && back) {
      notes.push(new Note(markdownToHTML(front), markdownToHTML(back)));
    }
  }
  return notes;
}

function tryHeadingPattern(content: string): Note[] {
  const sections = content.split(/^##+ /m);
  const notes: Note[] = [];
  for (const section of sections.slice(1)) {
    const newlineIdx = section.indexOf('\n');
    if (newlineIdx === -1) continue;
    const front = section.slice(0, newlineIdx).trim();
    const back = section.slice(newlineIdx).trim();
    if (front && back) {
      notes.push(new Note(markdownToHTML(front), markdownToHTML(back)));
    }
  }
  return notes;
}

function tryQALabelPattern(content: string): Note[] {
  const lines = content.split('\n');
  const notes: Note[] = [];
  let front = '';
  const backLines: string[] = [];

  for (const line of lines) {
    const qMatch = /^Q:\s*(.+)/i.exec(line);
    const aMatch = /^A:\s*(.*)/i.exec(line);

    if (qMatch) {
      if (front && backLines.length > 0) {
        notes.push(
          new Note(
            markdownToHTML(front),
            markdownToHTML(backLines.join('\n').trim())
          )
        );
      }
      front = qMatch[1].trim();
      backLines.length = 0;
    } else if (aMatch && front) {
      backLines.push(aMatch[1]);
    } else if (front && backLines.length > 0 && line.trim()) {
      backLines.push(line);
    }
  }

  if (front && backLines.length > 0) {
    notes.push(
      new Note(
        markdownToHTML(front),
        markdownToHTML(backLines.join('\n').trim())
      )
    );
  }
  return notes;
}

function parseAnkdownCards(body: string): Note[] {
  const notes: Note[] = [];
  for (const card of body.split(/\n---\n/)) {
    const parts = card.split(/\n%\n/);
    if (parts.length >= 2) {
      const front = parts[0].trim();
      const back = parts[1].trim();
      if (front && back) {
        notes.push(new Note(markdownToHTML(front), markdownToHTML(back)));
      }
    }
  }
  return notes;
}

function trySeparatorPattern(content: string): Note[] {
  const body = content.replace(/^---\n[\s\S]+?\n---\n/, '');

  if (body.includes('\n%\n')) {
    return parseAnkdownCards(body);
  }

  const pairs = body.split(/\n\n---\n\n/);
  if (pairs.length < 2) return [];

  const notes: Note[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const front = pairs[i].trim();
    const back = pairs[i + 1].trim();
    if (front && back) {
      notes.push(new Note(markdownToHTML(front), markdownToHTML(back)));
    }
  }
  return notes;
}

function indexOfSeparatorColon(line: string): number {
  let idx = line.indexOf('::');
  while (idx !== -1) {
    const before = line.slice(0, idx);
    const insideCloze = /\{\{c\d+$/.test(before);
    if (!insideCloze) {
      return idx;
    }
    idx = line.indexOf('::', idx + 2);
  }
  return -1;
}

function tryInlineDoubleColonPattern(content: string): Note[] {
  const lines = content.split('\n');
  const notes: Note[] = [];
  for (const line of lines) {
    const idx = indexOfSeparatorColon(line);
    if (idx === -1) continue;
    const front = line.slice(0, idx).trim();
    const back = line.slice(idx + 2).trim();
    if (front && back && !front.startsWith('#') && !front.includes('://')) {
      notes.push(new Note(markdownToHTML(front), markdownToHTML(back)));
    }
  }
  return notes;
}

export interface MarkdownHeuristicResult {
  notes: Note[];
  formatDetected: string;
}

export function guessMarkdownCards(
  content: string
): MarkdownHeuristicResult | null {
  const patterns: Array<{ name: string; fn: (c: string) => Note[] }> = [
    { name: 'details-summary', fn: tryDetailsPattern },
    { name: 'heading-body', fn: tryHeadingPattern },
    { name: 'qa-labels', fn: tryQALabelPattern },
    { name: 'separator', fn: trySeparatorPattern },
    { name: 'inline-double-colon', fn: tryInlineDoubleColonPattern },
  ];

  for (const { name, fn } of patterns) {
    const notes = fn(content);
    if (notes.length > 0) {
      return { notes, formatDetected: name };
    }
  }

  return null;
}

export function matchesMarkdownHeuristic(content: string): boolean {
  return guessMarkdownCards(content) !== null;
}

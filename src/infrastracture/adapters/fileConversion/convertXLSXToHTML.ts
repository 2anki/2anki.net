import { escapeHtml } from '../../../lib/notion-render/escape';
import {
  TabularRow,
  cellText,
  detectFieldColumns,
  sheetsFromBuffer,
} from './tabularRows';

interface FrontBackColumns {
  rows: TabularRow[];
  frontIndex: number;
  backIndex: number;
}

function resolveColumns(rows: TabularRow[]): FrontBackColumns {
  if (rows.length === 0) {
    return { rows, frontIndex: 0, backIndex: 1 };
  }
  const named = detectFieldColumns(rows[0]);
  if (named) {
    return {
      rows: rows.slice(1),
      frontIndex: named.frontIndex,
      backIndex: named.backIndex,
    };
  }
  // No fuzzy header guess: a short-text data row is indistinguishable from a
  // header, and silently dropping a real first card is worse than shipping a
  // visible, deletable header card (#3945).
  return { rows, frontIndex: 0, backIndex: 1 };
}

// A line break inside a cell (alt+enter in the spreadsheet) carries meaning the
// learner put there, so it becomes a <br> after escaping rather than collapsing
// into a space that merges two lines into one run of text.
function cellHtml(cell: unknown): string {
  return escapeHtml(cellText(cell)).replace(/\r\n|\r|\n/g, '<br>');
}

function toggleListForSheet(rows: TabularRow[]): string {
  const { rows: cardRows, frontIndex, backIndex } = resolveColumns(rows);
  return cardRows
    .map((row: TabularRow) => {
      const front = cellHtml(row[frontIndex]);
      const back = cellHtml(row[backIndex]);
      return `<ul class="toggle">
    <li>
      <details>
        <summary>${front}</summary>
        <p>${back}</p>
      </details>
    </li>
    </ul>`;
    })
    .join('\n');
}

export function convertXLSXToHTML(buffer: Buffer, title: string): string {
  const body = sheetsFromBuffer(buffer, title)
    .map((sheet) => toggleListForSheet(sheet.rows))
    .filter((html) => html.length > 0)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(title)}</title></head>
<body>
  ${body}
</body>
</html>`;
}

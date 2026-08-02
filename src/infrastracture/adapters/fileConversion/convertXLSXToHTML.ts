import { escapeHtml } from '../../../lib/notion-render/escape';
import {
  TabularRow,
  cellText,
  detectFieldColumns,
  rowsFromBuffer,
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

export function convertXLSXToHTML(buffer: Buffer, title: string): string {
  const { rows, frontIndex, backIndex } = resolveColumns(
    rowsFromBuffer(buffer)
  );

  return `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(title)}</title></head>
<body>
  ${rows
    .map((row: TabularRow) => {
      const front = escapeHtml(cellText(row[frontIndex]));
      const back = escapeHtml(cellText(row[backIndex]));
      return `<ul class="toggle">
    <li>
      <details>
        <summary>${front}</summary>
        <p>${back}</p>
      </details>
    </li>
    </ul>`;
    })
    .join('\n')}
</body>
</html>`;
}

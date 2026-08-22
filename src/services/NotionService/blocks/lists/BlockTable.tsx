import {
  ListBlockChildrenResponse,
  RichTextItemResponse,
  TableBlockObjectResponse,
  TableRowBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { inferColumnMapping } from '../../../../lib/notionDatabase/inferColumnMapping';
import handleClozeDeletions from '../../../../lib/parser/helpers/handleClozeDeletions';
import hasInlineClozeCode from '../../../../lib/parser/helpers/hasInlineClozeCode';
import type { IBlockRenderer } from '../../BlockHandler/types';
import renderTextChildren from '../../helpers/renderTextChildren';

interface TableCard {
  front: string;
  back: string;
  isCloze: boolean;
}

interface ColumnRoles {
  frontIndex: number;
  backIndex: number;
}

const DEFAULT_COLUMN_ROLES: ColumnRoles = { frontIndex: 0, backIndex: 1 };

function toClozeCard(front: string, back: string): TableCard {
  if (hasInlineClozeCode(front)) {
    return { front: handleClozeDeletions(front), back, isCloze: true };
  }
  if (hasInlineClozeCode(back)) {
    return { front: handleClozeDeletions(back), back: front, isCloze: true };
  }
  return { front, back, isCloze: false };
}

function renderCell(
  cell: RichTextItemResponse[],
  handler: IBlockRenderer
): string {
  return renderTextChildren(cell, handler.settings, handler.tagRegistry);
}

function buildExtraColumnsTable(
  extraCells: RichTextItemResponse[][],
  handler: IBlockRenderer
): string {
  const tds = extraCells
    .map((cell) => `<td>${renderCell(cell, handler)}</td>`)
    .join('');
  return `<table><tbody><tr>${tds}</tr></tbody></table>`;
}

function resolveColumnRoles(
  rows: readonly TableRowBlockObjectResponse[],
  hasColumnHeader: boolean,
  handler: IBlockRenderer
): ColumnRoles {
  const headerRow = rows[0];
  if (!hasColumnHeader || headerRow == null) {
    return DEFAULT_COLUMN_ROLES;
  }

  const columnNames = headerRow.table_row.cells.map((cell) =>
    renderCell(cell, handler).trim()
  );
  const mapping = inferColumnMapping(columnNames);
  if (mapping.frontField == null || mapping.backField == null) {
    return DEFAULT_COLUMN_ROLES;
  }

  const frontIndex = columnNames.indexOf(mapping.frontField);
  const backIndex = columnNames.indexOf(mapping.backField);
  if (frontIndex < 0 || backIndex < 0 || frontIndex === backIndex) {
    return DEFAULT_COLUMN_ROLES;
  }

  return { frontIndex, backIndex };
}

function extraColumnCells(
  cells: RichTextItemResponse[][],
  roles: ColumnRoles
): RichTextItemResponse[][] {
  return cells.filter(
    (_cell, index) => index !== roles.frontIndex && index !== roles.backIndex
  );
}

export function tableRowsToCards(
  block: TableBlockObjectResponse,
  children: ListBlockChildrenResponse,
  handler: IBlockRenderer
): TableCard[] {
  const rows = children.results.filter(
    (r): r is TableRowBlockObjectResponse =>
      'type' in r && r.type === 'table_row'
  );

  if (block.table.table_width < 2) {
    console.debug('tableRowsToCards: skipping 1-column table', block.id);
    return [];
  }

  const roles = resolveColumnRoles(
    rows,
    block.table.has_column_header,
    handler
  );
  const dataRows = block.table.has_column_header ? rows.slice(1) : rows;

  let skippedCount = 0;
  const cards: TableCard[] = [];

  for (const row of dataRows) {
    const cells = row.table_row.cells;
    const front = renderCell(cells[roles.frontIndex] ?? [], handler);
    const backColumn = renderCell(cells[roles.backIndex] ?? [], handler);

    if (!front || !backColumn) {
      skippedCount++;
      continue;
    }

    const extraCells = extraColumnCells(cells, roles);
    const back =
      extraCells.length > 0
        ? backColumn + buildExtraColumnsTable(extraCells, handler)
        : backColumn;

    if (handler.settings.isCloze) {
      cards.push(toClozeCard(front, back));
    } else {
      cards.push({ front, back, isCloze: false });
    }
  }

  if (skippedCount > 0) {
    console.debug(
      `tableRowsToCards: skipped ${skippedCount} row(s) with empty front or back column`,
      block.id
    );
  }

  return cards;
}

export async function BlockTable(
  block: TableBlockObjectResponse,
  handler: IBlockRenderer
): Promise<string> {
  const children = await handler.api.getBlocks({
    createdAt: block.created_time,
    lastEditedAt: block.last_edited_time,
    id: block.id,
    all: handler.useAll,
    type: block.type,
  });

  const rows = children.results.filter(
    (r): r is TableRowBlockObjectResponse =>
      'type' in r && r.type === 'table_row'
  );

  if (rows.length === 0) {
    return '';
  }

  const renderRow = (
    row: TableRowBlockObjectResponse,
    isHeader: boolean
  ): string => {
    const tag = isHeader ? 'th' : 'td';
    const cells = row.table_row.cells
      .map((cell) => `<${tag}>${renderCell(cell, handler)}</${tag}>`)
      .join('');
    return `<tr>${cells}</tr>`;
  };

  const [firstRow, ...remainingRows] = rows;
  let tbody = '';

  if (block.table.has_column_header) {
    const thead = `<thead>${renderRow(firstRow, true)}</thead>`;
    const bodyRows = remainingRows.map((r) => renderRow(r, false)).join('');
    tbody = `${thead}<tbody>${bodyRows}</tbody>`;
  } else {
    const allRows = rows.map((r) => renderRow(r, false)).join('');
    tbody = `<tbody>${allRows}</tbody>`;
  }

  return `<table>${tbody}</table>`;
}

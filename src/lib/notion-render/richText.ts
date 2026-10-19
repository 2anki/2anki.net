import { escapeAttribute, escapeHtml } from './escape';
import { NotionRichTextItem } from './types';
import notionColorToHex, {
  NOTION_COLORS,
  isNotionColorBackground,
  notionBackgroundColor,
} from '../../services/NotionService/NotionColors';

const COLOR_NAMES = new Set(NOTION_COLORS.map((c) => c.name));

const wrap = (open: string, close: string, inner: string): string =>
  `${open}${inner}${close}`;

const colorStyle = (color: string): string | null => {
  if (isNotionColorBackground(color)) {
    const background = notionBackgroundColor(color);
    return background == null ? null : `background-color: ${background}`;
  }
  return `color: ${notionColorToHex(color)}`;
};

const colorStyleOrNull = (color: string | undefined): string | null => {
  if (color == null || color === 'default' || !COLOR_NAMES.has(color)) {
    return null;
  }
  return colorStyle(color);
};

export const wrapWithColorClass = (
  color: string | undefined,
  inner: string
): string => {
  const style = colorStyleOrNull(color);
  if (style == null) {
    return inner;
  }
  return `<span class="n2a-highlight-${color}" style="${style}">${inner}</span>`;
};

export const wrapBlockWithColorClass = (
  color: string | undefined,
  inner: string
): string => {
  const style = colorStyleOrNull(color);
  if (style == null) {
    return inner;
  }
  return `<div class="block-color-${color}" style="${style}">${inner}</div>`;
};

export const renderRichTextItem = (item: NotionRichTextItem): string => {
  if (item.type === 'equation' && item.equation?.expression != null) {
    return `\\(${escapeHtml(item.equation.expression)}\\)`;
  }
  let inner = escapeHtml(item.plain_text ?? '');
  const a = item.annotations ?? {};
  if (a.code) inner = wrap('<code>', '</code>', inner);
  if (a.bold) inner = wrap('<strong>', '</strong>', inner);
  if (a.italic) inner = wrap('<em>', '</em>', inner);
  if (a.strikethrough) inner = wrap('<del>', '</del>', inner);
  if (a.underline) inner = wrap('<u>', '</u>', inner);
  inner = wrapWithColorClass(a.color, inner);
  if (item.href != null && item.href !== '') {
    inner = `<a href="${escapeAttribute(item.href)}">${inner}</a>`;
  }
  return inner;
};

export const renderRichText = (
  items: NotionRichTextItem[] | undefined
): string => {
  if (items == null || items.length === 0) return '';
  return items.map(renderRichTextItem).join('');
};

export const renderPlainText = (
  items: NotionRichTextItem[] | undefined
): string => {
  if (items == null) return '';
  return items.map((item) => item.plain_text ?? '').join('');
};

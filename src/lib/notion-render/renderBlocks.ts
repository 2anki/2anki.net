import { escapeAttribute, escapeHtml } from './escape';
import { highlightCode } from './highlightCode';
import { resolveEmbedUrl, resolveVideoUrl } from './embedUrl';
import {
  renderPlainText,
  renderRichText,
  wrapWithColorClass,
} from './richText';
import {
  NotionBlockChildrenFetcher,
  NotionRenderableBlock,
  NotionRichTextItem,
  RenderOptions,
  RenderedBlocks,
  WalkedNotionMediaRef,
} from './types';

const DEFAULT_MAX_DEPTH = 8;

const extToken = (url: string): string => {
  const cleaned = url.split('?')[0];
  const m = /\.([a-zA-Z0-9]{1,5})$/.exec(cleaned);
  if (m == null) return '';
  return m[1].toLowerCase();
};

const buildMediaFilename = (
  block: NotionRenderableBlock,
  url: string,
  fallback: string
): string => {
  const ext = extToken(url);
  const id = block.id ?? 'unknown';
  return `ankify-${id}.${ext === '' ? fallback : ext}`;
};

interface MediaContent {
  type: 'external' | 'file';
  external?: { url: string };
  file?: { url: string; expiry_time?: string };
  caption?: NotionRichTextItem[];
  name?: string;
}

const mediaUrl = (content: MediaContent): string | null => {
  if (content.type === 'external') return content.external?.url ?? null;
  return content.file?.url ?? null;
};

const renderCaption = (caption: NotionRichTextItem[] | undefined): string => {
  const html = renderRichText(caption);
  if (html === '') return '';
  return `<figcaption>${html}</figcaption>`;
};

interface ListBuffer {
  type: 'ul' | 'ol' | null;
  items: string[];
}

const flushList = (buf: ListBuffer): string => {
  if (buf.type == null || buf.items.length === 0) {
    buf.type = null;
    buf.items = [];
    return '';
  }
  const tag = buf.type;
  const html = `<${tag}>${buf.items.join('')}</${tag}>`;
  buf.type = null;
  buf.items = [];
  return html;
};

const pushListItem = (
  buf: ListBuffer,
  type: 'ul' | 'ol',
  itemHtml: string,
  out: string[]
): void => {
  if (buf.type !== type) {
    const flushed = flushList(buf);
    if (flushed !== '') out.push(flushed);
    buf.type = type;
  }
  buf.items.push(`<li>${itemHtml}</li>`);
};

const renderImageBlock = (
  block: NotionRenderableBlock,
  media: WalkedNotionMediaRef[]
): string => {
  const content = block.image;
  if (content == null || block.id == null) return '';
  const url = mediaUrl(content);
  if (url == null) return '';
  const filename = buildMediaFilename(block, url, 'png');
  media.push({
    block_id: block.id,
    kind: 'image',
    source: content.type,
    url,
    filename,
  });
  return `<img src="${escapeAttribute(filename)}">${renderCaption(content.caption)}`;
};

const renderVideoBlock = (
  block: NotionRenderableBlock,
  media: WalkedNotionMediaRef[]
): string => {
  const content = block.video;
  if (content == null || block.id == null) return '';
  const url = mediaUrl(content);
  if (url == null) return '';
  const caption = renderCaption(content.caption);
  if (content.type === 'external') {
    const resolved = resolveVideoUrl(url);
    media.push({
      block_id: block.id,
      kind: 'video',
      source: 'external',
      url,
    });
    if (resolved.kind === 'iframe') {
      return `<iframe width="560" height="315" src="${escapeAttribute(resolved.src)}" frameborder="0" allowfullscreen></iframe>${caption}`;
    }
    return `<video controls src="${escapeAttribute(resolved.url)}"></video>${caption}`;
  }
  const filename = buildMediaFilename(block, url, 'mp4');
  media.push({
    block_id: block.id,
    kind: 'video',
    source: 'file',
    url,
    filename,
  });
  return `<video controls src="${escapeAttribute(filename)}"></video>${caption}`;
};

const renderAudioBlock = (
  block: NotionRenderableBlock,
  media: WalkedNotionMediaRef[]
): string => {
  const content = block.audio;
  if (content == null || block.id == null) return '';
  const url = mediaUrl(content);
  if (url == null) return '';
  const filename = buildMediaFilename(block, url, 'mp3');
  media.push({
    block_id: block.id,
    kind: 'audio',
    source: content.type,
    url,
    filename,
  });
  const caption = renderCaption(content.caption);
  return `[sound:${filename}]${caption}`;
};

const renderFileBlock = (
  block: NotionRenderableBlock,
  media: WalkedNotionMediaRef[]
): string => {
  const content = block.file;
  if (content == null || block.id == null) return '';
  const url = mediaUrl(content);
  if (url == null) return '';
  const filename = buildMediaFilename(block, url, 'bin');
  media.push({
    block_id: block.id,
    kind: 'file',
    source: content.type,
    url,
    filename,
  });
  const label = content.name ?? filename;
  const caption = renderCaption(content.caption);
  return `<a href="${escapeAttribute(filename)}">${escapeHtml(label)}</a>${caption}`;
};

const renderPdfBlock = (
  block: NotionRenderableBlock,
  media: WalkedNotionMediaRef[]
): string => {
  const content = block.pdf;
  if (content == null || block.id == null) return '';
  const url = mediaUrl(content);
  if (url == null) return '';
  const filename = buildMediaFilename(block, url, 'pdf');
  media.push({
    block_id: block.id,
    kind: 'file',
    source: content.type,
    url,
    filename,
  });
  const caption = renderCaption(content.caption);
  return `<iframe src="${escapeAttribute(filename)}" width="100%" height="400"></iframe>${caption}`;
};

const renderEmbedBlock = (block: NotionRenderableBlock): string => {
  const content = block.embed;
  if (content?.url == null || content.url === '') return '';
  const resolved = resolveEmbedUrl(content.url);
  if (resolved.kind === 'iframe') {
    return `<iframe width="560" height="315" src="${escapeAttribute(resolved.src)}" frameborder="0" allowfullscreen></iframe>`;
  }
  if (resolved.kind === 'twitter-link') {
    return `<div class="source"><a href="${escapeAttribute(resolved.url)}">${escapeHtml(resolved.url)}</a></div>`;
  }
  return `<a href="${escapeAttribute(resolved.url)}">${escapeHtml(resolved.url)}</a>`;
};

const renderBookmarkBlock = (block: NotionRenderableBlock): string => {
  const content = block.bookmark;
  if (content?.url == null || content.url === '') return '';
  return `<a href="${escapeAttribute(content.url)}">${escapeHtml(content.url)}</a>`;
};

const renderHeading = (
  level: 1 | 2 | 3,
  block: NotionRenderableBlock
): string => {
  const holder =
    level === 1
      ? block.heading_1
      : level === 2
        ? block.heading_2
        : block.heading_3;
  const inner = renderRichText(holder?.rich_text);
  if (inner === '') return '';
  return `<h${level}>${wrapWithColorClass(holder?.color, inner)}</h${level}>`;
};

const renderTodo = (block: NotionRenderableBlock): string => {
  const inner = renderRichText(block.to_do?.rich_text);
  if (inner === '') return '';
  const mark = block.to_do?.checked === true ? '☑' : '☐';
  return `<div class="todo">${mark} ${wrapWithColorClass(block.to_do?.color, inner)}</div>`;
};

const renderQuote = (block: NotionRenderableBlock): string => {
  const inner = renderRichText(block.quote?.rich_text);
  if (inner === '') return '';
  return `<blockquote>${wrapWithColorClass(block.quote?.color, inner)}</blockquote>`;
};

const renderCode = (block: NotionRenderableBlock): string => {
  const inner = renderPlainText(block.code?.rich_text);
  if (inner === '') return '';
  const lang = block.code?.language ?? 'plaintext';
  const highlighted = highlightCode(inner, lang);
  return `<pre><code class="hljs language-${escapeAttribute(lang)}">${highlighted}</code></pre>`;
};

const renderEquation = (block: NotionRenderableBlock): string => {
  const expr = block.equation?.expression;
  if (expr == null || expr === '') return '';
  return `\\[${escapeHtml(expr)}\\]`;
};

const renderChildPageTitle = (block: NotionRenderableBlock): string => {
  const title = block.child_page?.title ?? block.child_database?.title;
  if (title == null || title === '') return '';
  return `<p><strong>${escapeHtml(title)}</strong></p>`;
};

interface RenderContext {
  fetchChildren: NotionBlockChildrenFetcher;
  maxDepth: number;
  media: WalkedNotionMediaRef[];
  unsupportedTypes: string[];
}

const renderToggle = async (
  block: NotionRenderableBlock,
  ctx: RenderContext,
  depth: number
): Promise<string> => {
  const summary = renderRichText(block.toggle?.rich_text);
  const childrenHtml = await renderChildren(block, ctx, depth);
  return `<details><summary>${summary}</summary>${childrenHtml}</details>`;
};

const renderCallout = async (
  block: NotionRenderableBlock,
  ctx: RenderContext,
  depth: number
): Promise<string> => {
  const inner = renderRichText(block.callout?.rich_text);
  const emoji =
    block.callout?.icon?.type === 'emoji'
      ? (block.callout.icon.emoji ?? '')
      : '';
  const childrenHtml = await renderChildren(block, ctx, depth);
  const head = emoji === '' ? inner : `${escapeHtml(emoji)} ${inner}`;
  return `<div class="callout">${wrapWithColorClass(block.callout?.color, head)}${childrenHtml}</div>`;
};

const renderChildren = async (
  block: NotionRenderableBlock,
  ctx: RenderContext,
  depth: number
): Promise<string> => {
  if (block.has_children !== true || block.id == null) return '';
  if (depth >= ctx.maxDepth) return '';
  const children = await ctx.fetchChildren(block.id);
  return await renderBlockList(children, ctx, depth + 1);
};

const renderTableRow = (
  block: NotionRenderableBlock,
  isHeader: boolean
): string => {
  const tag = isHeader ? 'th' : 'td';
  const cells = (block.table_row?.cells ?? [])
    .map((cell) => `<${tag}>${renderRichText(cell)}</${tag}>`)
    .join('');
  return `<tr>${cells}</tr>`;
};

const renderTable = async (
  block: NotionRenderableBlock,
  ctx: RenderContext,
  depth: number
): Promise<string> => {
  if (block.has_children !== true || block.id == null) return '';
  if (depth >= ctx.maxDepth) return '';
  const children = await ctx.fetchChildren(block.id);
  const rows = children.filter((child) => child.type === 'table_row');
  if (rows.length === 0) return '';
  if (block.table?.has_column_header === true) {
    const [headerRow, ...bodyRows] = rows;
    const thead = `<thead>${renderTableRow(headerRow, true)}</thead>`;
    const body = bodyRows.map((r) => renderTableRow(r, false)).join('');
    return `<table>${thead}<tbody>${body}</tbody></table>`;
  }
  const body = rows.map((r) => renderTableRow(r, false)).join('');
  return `<table><tbody>${body}</tbody></table>`;
};

const renderColumnList = async (
  block: NotionRenderableBlock,
  ctx: RenderContext,
  depth: number
): Promise<string> => {
  if (block.has_children !== true || block.id == null) return '';
  if (depth >= ctx.maxDepth) return '';
  const columns = await ctx.fetchChildren(block.id);
  const parts: string[] = [];
  for (const column of columns) {
    if (column.type !== 'column') continue;
    const inner = await renderChildren(column, ctx, depth + 1);
    if (inner !== '') parts.push(inner);
  }
  return parts.join('\n');
};

const renderBlockList = async (
  blocks: NotionRenderableBlock[],
  ctx: RenderContext,
  depth: number
): Promise<string> => {
  const out: string[] = [];
  const buf: ListBuffer = { type: null, items: [] };

  for (const block of blocks) {
    const isList =
      block.type === 'bulleted_list_item' ||
      block.type === 'numbered_list_item';
    if (!isList) {
      const flushed = flushList(buf);
      if (flushed !== '') out.push(flushed);
    }

    switch (block.type) {
      case 'paragraph': {
        const inner = renderRichText(block.paragraph?.rich_text);
        if (inner !== '')
          out.push(
            `<p>${wrapWithColorClass(block.paragraph?.color, inner)}</p>`
          );
        break;
      }
      case 'heading_1':
        out.push(renderHeading(1, block));
        break;
      case 'heading_2':
        out.push(renderHeading(2, block));
        break;
      case 'heading_3':
      case 'heading_4':
        out.push(renderHeading(3, block));
        break;
      case 'bulleted_list_item': {
        const holder = block.bulleted_list_item;
        const rendered = renderRichText(holder?.rich_text);
        const text =
          rendered === '' ? '' : wrapWithColorClass(holder?.color, rendered);
        const itemHtml = text + (await renderChildren(block, ctx, depth));
        if (itemHtml !== '') pushListItem(buf, 'ul', itemHtml, out);
        break;
      }
      case 'numbered_list_item': {
        const holder = block.numbered_list_item;
        const rendered = renderRichText(holder?.rich_text);
        const text =
          rendered === '' ? '' : wrapWithColorClass(holder?.color, rendered);
        const itemHtml = text + (await renderChildren(block, ctx, depth));
        if (itemHtml !== '') pushListItem(buf, 'ol', itemHtml, out);
        break;
      }
      case 'to_do':
        out.push(renderTodo(block));
        break;
      case 'toggle':
        out.push(await renderToggle(block, ctx, depth));
        break;
      case 'quote':
        out.push(renderQuote(block));
        break;
      case 'callout':
        out.push(await renderCallout(block, ctx, depth));
        break;
      case 'code':
        out.push(renderCode(block));
        break;
      case 'equation':
        out.push(renderEquation(block));
        break;
      case 'divider':
        out.push('<hr>');
        break;
      case 'image':
        out.push(renderImageBlock(block, ctx.media));
        break;
      case 'video':
        out.push(renderVideoBlock(block, ctx.media));
        break;
      case 'audio':
        out.push(renderAudioBlock(block, ctx.media));
        break;
      case 'file':
        out.push(renderFileBlock(block, ctx.media));
        break;
      case 'pdf':
        out.push(renderPdfBlock(block, ctx.media));
        break;
      case 'embed':
        out.push(renderEmbedBlock(block));
        break;
      case 'bookmark':
        out.push(renderBookmarkBlock(block));
        break;
      case 'child_page':
      case 'child_database':
        out.push(renderChildPageTitle(block));
        break;
      case 'table':
        out.push(await renderTable(block, ctx, depth));
        break;
      case 'table_row':
        break;
      case 'column_list':
        out.push(await renderColumnList(block, ctx, depth));
        break;
      case 'column':
        out.push(await renderChildren(block, ctx, depth));
        break;
      default:
        ctx.unsupportedTypes.push(block.type);
        break;
    }
  }

  const tail = flushList(buf);
  if (tail !== '') out.push(tail);

  return out.filter((s) => s !== '').join('\n');
};

export const renderNotionBlocks = async (
  blocks: NotionRenderableBlock[],
  fetchChildren: NotionBlockChildrenFetcher,
  options: RenderOptions = {}
): Promise<RenderedBlocks> => {
  const ctx: RenderContext = {
    fetchChildren,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    media: [],
    unsupportedTypes: [],
  };
  const html = await renderBlockList(blocks, ctx, 0);
  return { html, media: ctx.media, unsupportedTypes: ctx.unsupportedTypes };
};

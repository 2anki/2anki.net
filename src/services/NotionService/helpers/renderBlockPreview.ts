import {
  BlockObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import safeLinkHref from './safeLinkHref';

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function applyAnnotations(item: RichTextItemResponse, text: string): string {
  let html = escapeHtml(text);
  const { annotations } = item;
  if (annotations.code) html = `<code>${html}</code>`;
  if (annotations.bold) html = `<strong>${html}</strong>`;
  if (annotations.italic) html = `<em>${html}</em>`;
  if (annotations.underline) html = `<u>${html}</u>`;
  if (annotations.strikethrough) html = `<s>${html}</s>`;
  const href = safeLinkHref(item.href);
  if (href) {
    html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
  }
  return html;
}

function richText(items: RichTextItemResponse[] | undefined): string {
  if (!items || items.length === 0) return '';
  return items.map((item) => applyAnnotations(item, item.plain_text)).join('');
}

function imageUrl(
  block: Extract<BlockObjectResponse, { type: 'image' }>
): string | null {
  if (block.image.type === 'external') return block.image.external.url;
  if (block.image.type === 'file') return block.image.file.url;
  return null;
}

function isToggleableHeading(block: BlockObjectResponse): boolean {
  switch (block.type) {
    case 'heading_1':
      return block.heading_1.is_toggleable === true;
    case 'heading_2':
      return block.heading_2.is_toggleable === true;
    case 'heading_3':
      return block.heading_3.is_toggleable === true;
    case 'heading_4':
      return block.heading_4.is_toggleable === true;
    default:
      return false;
  }
}

export function isExpandable(block: BlockObjectResponse): boolean {
  if (block.type === 'toggle') return true;
  if (block.type === 'column_list') return true;
  if (block.type === 'column') return true;
  if (block.type === 'table') return true;
  return isToggleableHeading(block);
}

export function renderBlockSummary(block: BlockObjectResponse): string {
  switch (block.type) {
    case 'toggle':
      return richText(block.toggle.rich_text);
    case 'heading_1':
      return `<h1>${richText(block.heading_1.rich_text)}</h1>`;
    case 'heading_2':
      return `<h2>${richText(block.heading_2.rich_text)}</h2>`;
    case 'heading_3':
      return `<h3>${richText(block.heading_3.rich_text)}</h3>`;
    case 'heading_4':
      return `<h4>${richText(block.heading_4.rich_text)}</h4>`;
    case 'column_list':
      return '<p class="block-label">Columns</p>';
    case 'column':
      return '<p class="block-label">Column</p>';
    case 'table':
      return '<p class="block-label">Table</p>';
    default:
      return '';
  }
}

function fileOrExternalUrl(
  block:
    | { type: 'file'; file: { url: string } }
    | { type: 'external'; external: { url: string } }
): string {
  if (block.type === 'file') return block.file.url;
  return block.external.url;
}

export function renderBlockPreview(block: BlockObjectResponse): string {
  if (isExpandable(block)) return '';
  switch (block.type) {
    case 'paragraph':
      return `<p>${richText(block.paragraph.rich_text)}</p>`;
    case 'heading_1':
      return `<h1>${richText(block.heading_1.rich_text)}</h1>`;
    case 'heading_2':
      return `<h2>${richText(block.heading_2.rich_text)}</h2>`;
    case 'heading_3':
      return `<h3>${richText(block.heading_3.rich_text)}</h3>`;
    case 'heading_4':
      return `<h4>${richText(block.heading_4.rich_text)}</h4>`;
    case 'bulleted_list_item':
      return `<ul><li>${richText(block.bulleted_list_item.rich_text)}</li></ul>`;
    case 'numbered_list_item':
      return `<ol><li>${richText(block.numbered_list_item.rich_text)}</li></ol>`;
    case 'to_do': {
      const checked = block.to_do.checked ? ' checked' : '';
      return `<label><input type="checkbox" disabled${checked} /> ${richText(block.to_do.rich_text)}</label>`;
    }
    case 'quote':
      return `<blockquote>${richText(block.quote.rich_text)}</blockquote>`;
    case 'code': {
      const lang = block.code.language ?? '';
      return `<pre><code data-lang="${escapeHtml(lang)}">${richText(block.code.rich_text)}</code></pre>`;
    }
    case 'callout': {
      const emoji =
        block.callout.icon?.type === 'emoji' ? block.callout.icon.emoji : '';
      return `<aside><span aria-hidden="true">${escapeHtml(emoji)}</span> ${richText(block.callout.rich_text)}</aside>`;
    }
    case 'divider':
      return `<hr />`;
    case 'image': {
      const url = imageUrl(block);
      if (!url) return '';
      const caption = richText(block.image.caption);
      return `<figure><img src="${escapeHtml(url)}" alt="" loading="lazy" />${
        caption ? `<figcaption>${caption}</figcaption>` : ''
      }</figure>`;
    }
    case 'bookmark':
      return `<p><a href="${escapeHtml(block.bookmark.url)}" target="_blank" rel="noreferrer">${escapeHtml(block.bookmark.url)}</a></p>`;
    case 'equation':
      return `<p><code>${escapeHtml(block.equation.expression)}</code></p>`;
    case 'child_page':
      return `<p><strong>📄 ${escapeHtml(block.child_page.title)}</strong> <em>(sub-page)</em></p>`;
    case 'child_database':
      return `<p><strong>🗃 ${escapeHtml(block.child_database.title)}</strong> <em>(database)</em></p>`;
    case 'table_row': {
      const cells = block.table_row.cells
        .map((cell) => richText(cell))
        .join(' | ');
      return `<p>${cells}</p>`;
    }
    case 'embed': {
      const url = block.embed.url;
      if (!url) return '';
      return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Embed: ${escapeHtml(url)}</a></p>`;
    }
    case 'video': {
      const url = fileOrExternalUrl(block.video);
      if (!url) return '';
      return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Video: ${escapeHtml(url)}</a></p>`;
    }
    case 'pdf': {
      const url = fileOrExternalUrl(block.pdf);
      if (!url) return '';
      return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">PDF: ${escapeHtml(url)}</a></p>`;
    }
    case 'audio': {
      const url = fileOrExternalUrl(block.audio);
      if (!url) return '';
      return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Audio: ${escapeHtml(url)}</a></p>`;
    }
    case 'file': {
      const url = fileOrExternalUrl(block.file);
      if (!url) return '';
      return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">File: ${escapeHtml(url)}</a></p>`;
    }
    case 'link_to_page': {
      const linked = block.link_to_page;
      let linkedId: string | null = null;
      if (linked.type === 'page_id') linkedId = linked.page_id;
      else if (linked.type === 'database_id') linkedId = linked.database_id;
      if (!linkedId) return '<p><em>(link to page)</em></p>';
      return `<p><a href="/notion/${escapeHtml(linkedId)}">Link to page</a></p>`;
    }
    case 'link_preview': {
      const url = block.link_preview.url;
      if (!url) return '';
      return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Link preview: ${escapeHtml(url)}</a></p>`;
    }
    case 'breadcrumb':
      return '<p><em>(breadcrumb)</em></p>';
    case 'table_of_contents':
      return '<p><em>(table of contents)</em></p>';
    case 'synced_block':
      return '<p><em>(synced block)</em></p>';
    case 'template':
      return '<p><em>(template)</em></p>';
    case 'unsupported':
      return '<p><em>(unsupported block)</em></p>';
    default:
      return '';
  }
}

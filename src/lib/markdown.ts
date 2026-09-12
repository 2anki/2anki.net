import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import multimdTable from 'markdown-it-multimd-table';

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
  xhtmlOut: true,
})
  .use(multimdTable)
  .use(taskLists);

const ASIDE_TAG_RE = /^<\/?aside[^>]*>\s*$/gim;

const CARD_SAFE_TAGS =
  'ruby|rt|rp|rb|details|summary|br|b|strong|i|em|u|s|code|sub|sup|mark|small';
const ESCAPED_CARD_SAFE_TAG_RE = new RegExp(
  `&lt;(/?(?:${CARD_SAFE_TAGS}))&gt;`,
  'gi'
);

const restoreCardSafeTags = (html: string): string =>
  html.replace(ESCAPED_CARD_SAFE_TAG_RE, '<$1>');

// markdown-it runs with html:false, so a raw <img> in a document arrives as
// escaped text and Anki shows the base64 of an inline image as a wall of
// characters (#4403). Rebuild the tag from src and alt only; every other
// attribute (event handlers included) stays dropped.
const ESCAPED_IMG_RE = /&lt;img\b([^&]*?(?:&(?!gt;)[^&]*?)*)\/?&gt;/gi;
const IMAGE_SRC_SCHEME_RE = /^(?:data:image\/|https?:\/\/|[^:]*$)/i;

const decodeAttributeEntities = (text: string): string =>
  text
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');

const attributeValue = (attributes: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i').exec(
    attributes
  );
  if (!match) return null;
  return match[1] ?? match[2] ?? '';
};

const restoreEscapedImages = (html: string): string =>
  html.replace(ESCAPED_IMG_RE, (whole, rawAttributes: string) => {
    const attributes = decodeAttributeEntities(rawAttributes);
    const src = attributeValue(attributes, 'src');
    if (!src || !IMAGE_SRC_SCHEME_RE.test(src)) return whole;
    const alt = attributeValue(attributes, 'alt');
    const altAttribute =
      alt == null ? '' : ` alt="${alt.replaceAll('"', '&quot;')}"`;
    return `<img src="${src.replaceAll('"', '&quot;')}"${altAttribute}>`;
  });

export const markdownToHTML = (
  html: string,
  trimWhitespace: boolean = false
) => {
  const stripped = html.replace(ASIDE_TAG_RE, '');
  const input = trimWhitespace ? stripped.trim() : stripped;
  return restoreEscapedImages(restoreCardSafeTags(md.render(input)));
};

export const markdownToInlineHTML = (text: string) =>
  restoreEscapedImages(restoreCardSafeTags(md.renderInline(text)));

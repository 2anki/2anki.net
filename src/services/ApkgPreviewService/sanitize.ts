import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'a',
  'article',
  'b',
  'blockquote',
  'br',
  'code',
  'details',
  'div',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'ruby',
  'rt',
  'rp',
  'rb',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'svg',
  'g',
  'image',
  'rect',
  'ellipse',
  'polygon',
];

const ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*': ['class', 'style', 'dir', 'lang'],
  a: ['href', 'target', 'rel'],
  details: ['open'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  audio: ['src', 'controls', 'preload'],
  video: ['src', 'controls', 'preload', 'poster', 'width', 'height'],
  source: ['src', 'type'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  svg: ['class', 'viewBox', 'preserveAspectRatio', 'xmlns'],
  image: ['href', 'src', 'x', 'y', 'width', 'height', 'preserveAspectRatio'],
  rect: ['x', 'y', 'width', 'height', 'fill', 'stroke', 'stroke-width'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width'],
  polygon: ['points', 'fill', 'stroke', 'stroke-width'],
};

// The print path renders every card into one headless-Chrome page that runs
// no deck scripts, so it can afford what the shared surfaces cannot:
// - `id` attributes, so the deck's own `#popup { display: none }`-style rules
//   keep its interactive chrome hidden the way Anki shows the card before
//   any click;
// - dropping <button> with its label. Without the template's scripts a button
//   does nothing, and its label (`×`, "Reveal Next") is not card content.
const PRINT_ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  ...ALLOWED_ATTRS,
  '*': ['class', 'style', 'dir', 'lang', 'id'],
};
// sanitize-html's own default list plus <button>. `xmp` must stay: dropping
// it from the list re-emits its raw text unescaped.
const PRINT_NON_TEXT_TAGS = [
  'script',
  'style',
  'textarea',
  'option',
  'xmp',
  'button',
];

// Same reasoning as dropping <button>: popup chrome also hangs its controls
// off script-driven anchors that have no href (a `↪` "open" glyph next to the
// `×` close button). Stripped of scripts the anchor leads nowhere, and its
// glyph is not card content. An anchor wrapping an image is kept — that is a
// linked logo or figure, not a dead control.
const isDeadPrintAnchor = (frame: sanitizeHtml.IFrame): boolean =>
  frame.tag === 'a' && !frame.attribs.href && frame.mediaChildren.length === 0;

export interface SanitizeCardOptions {
  print?: boolean;
}

export function sanitizeCardHtml(
  html: string,
  options: SanitizeCardOptions = {}
): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: options.print ? PRINT_ALLOWED_ATTRS : ALLOWED_ATTRS,
    nonTextTags: options.print ? PRINT_NON_TEXT_TAGS : undefined,
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    disallowedTagsMode: 'discard',
    exclusiveFilter: options.print ? isDeadPrintAnchor : undefined,
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: false },
  });
}

export function sanitizeCss(css: string): string {
  return (
    css
      .replace(/@import[^;]*;/gi, '')
      .replace(/expression\s*\(/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/<\/?style[^>]*>/gi, '')
      // The CSS is written into a <style> element. Stripping `</style>`
      // alone can be defeated (`</sty</style>le>` re-forms it), so escape
      // every `<` as the CSS escape `\3c ` — no HTML tag can survive.
      .replaceAll('<', String.raw`\3c `)
  );
}

const STYLE_BLOCK_REGEX = /<style\b[^>]*>([\s\S]*?)<\/style>/gi; // NOSONAR

// Card templates often carry their own <style> blocks (AnKing hides its
// Wikipedia popup this way). The HTML sanitizer drops them, so the print
// path lifts them out of the template and appends them to the note CSS.
export function extractTemplateStyles(template: string): string {
  const blocks: string[] = [];
  for (const match of template.matchAll(STYLE_BLOCK_REGEX)) {
    blocks.push(match[1]);
  }
  return blocks.join('\n');
}

// Images saved inside an HTML file as base64 data URIs are the one thing that
// makes a page huge: a 42 MB export is almost all picture bytes wrapped in a
// few hundred KB of text. Left inline, each image rides through the cheerio
// tree, every card's HTML string, the card-cleaning passes and the exporter's
// JSON payload, so one upload holds four or five copies of every picture on
// the V8 heap and a paying user's page dies at the child's 1 GB cap. Pulling
// the bytes out to disk before the DOM is built leaves one copy, the uploaded
// file itself, instead of five; the cards then reference an ordinary media
// file the exporter already knows how to bundle.
//
// This is a hand-rolled scan rather than a regex because the input is a
// user-controlled file of up to 100 MB that runs inside a conversion-pool
// child: a lazy `<img[^>]*?` pattern went quadratic on a page full of `<img`
// with no `>` (17 s on 880 KB). Every step below looks at each character a
// bounded number of times, so a crafted page costs the same as an honest one.
//
// Anything unusual stays inline and takes the DOM path, which decodes
// entities before reading the src: an unknown subtype, a payload holding an
// HTML entity (`&#10;` line wraps, `&#43;` for a plus), a payload that runs
// into markup, extra parameters before `;base64`, or more images than the
// caps below. Decoding an entity-wrapped payload raw would skip the `&#;`
// characters and keep the digits, which corrupts the picture silently.

const EXTENSION_BY_SUBTYPE: ReadonlyMap<string, string> = new Map([
  ['png', 'png'],
  ['jpeg', 'jpg'],
  ['jpg', 'jpg'],
  ['gif', 'gif'],
  ['webp', 'webp'],
  ['svg+xml', 'svg'],
  ['bmp', 'bmp'],
  ['avif', 'avif'],
]);

const MARKER = 'data:image/';
const BASE64_TAG = ';base64,';
// Attributes an exporter puts before src on one <img>: alt text, a style
// block, a class list. Beyond this the `data:` is not treated as an img src.
const MAX_TAG_PREFIX_CHARS = 4096;
const MAX_SUBTYPE_CHARS = 32;
export const MAX_EXTRACTED_IMAGES = 5000;
export const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;

export type WriteExtractedImage = (bytes: Buffer, extension: string) => string;

export interface ExtractedDataUriImages {
  html: string;
  count: number;
  bytes: number;
}

function isSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

function isBase64Char(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47 ||
    code === 61 ||
    isSpace(code)
  );
}

// True when the `data:` at `at` sits directly inside an <img> tag's src
// attribute: `<img ... src="data:` with no `>` between the tag name and here.
function isImgSrcValue(html: string, at: number): boolean {
  const quoteAt = at - 1;
  const quote = html[quoteAt];
  if (quote !== '"' && quote !== "'") return false;
  if (html.slice(quoteAt - 4, quoteAt) !== 'src=') return false;
  if (!isSpace(html.charCodeAt(quoteAt - 5))) return false;
  const stop = Math.max(0, quoteAt - MAX_TAG_PREFIX_CHARS);
  for (let i = quoteAt - 5; i >= stop; i -= 1) {
    const ch = html[i];
    if (ch === '>') return false;
    if (ch === '<') {
      return (
        /^<img$/i.test(html.slice(i, i + 4)) &&
        (isSpace(html.charCodeAt(i + 4)) || html[i + 4] === '/')
      );
    }
  }
  return false;
}

export function extractDataUriImages(
  html: string,
  writeImage: WriteExtractedImage
): ExtractedDataUriImages {
  if (!html.includes(MARKER)) {
    return { html, count: 0, bytes: 0 };
  }
  const out: string[] = [];
  let copied = 0;
  let count = 0;
  let bytes = 0;
  let cursor = 0;
  while (count < MAX_EXTRACTED_IMAGES && bytes < MAX_EXTRACTED_BYTES) {
    const at = html.indexOf(MARKER, cursor);
    if (at < 0) break;
    cursor = at + MARKER.length;
    if (!isImgSrcValue(html, at)) continue;

    const quote = html[at - 1];
    const subtypeStart = at + MARKER.length;
    const subtypeEnd = html.indexOf(BASE64_TAG, subtypeStart);
    if (subtypeEnd < 0 || subtypeEnd - subtypeStart > MAX_SUBTYPE_CHARS) {
      continue;
    }
    const extension = EXTENSION_BY_SUBTYPE.get(
      html.slice(subtypeStart, subtypeEnd).toLowerCase()
    );
    if (!extension) continue;

    const payloadStart = subtypeEnd + BASE64_TAG.length;
    let payloadEnd = payloadStart;
    while (
      payloadEnd < html.length &&
      isBase64Char(html.charCodeAt(payloadEnd))
    ) {
      payloadEnd += 1;
    }
    cursor = payloadEnd;
    if (html[payloadEnd] !== quote || payloadEnd === payloadStart) continue;

    const image = Buffer.from(
      html.slice(payloadStart, payloadEnd).replace(/\s+/g, ''),
      'base64'
    );
    if (image.length === 0) continue;

    const fileName = writeImage(image, extension);
    count += 1;
    bytes += image.length;
    out.push(html.slice(copied, at), fileName);
    copied = payloadEnd;
  }
  if (count === 0) {
    return { html, count: 0, bytes: 0 };
  }
  out.push(html.slice(copied));
  return { html: out.join(''), count, bytes };
}

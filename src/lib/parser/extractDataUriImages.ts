// Images saved inside an HTML file as base64 data URIs are the one thing that
// makes a page huge: a 42 MB export is almost all picture bytes wrapped in a
// few hundred KB of text. Left inline, each image rides through the cheerio
// tree, every card's HTML string, the card-cleaning passes and the exporter's
// JSON payload, so one upload holds four or five copies of every picture on
// the V8 heap and a paying user's page dies at the child's 1 GB cap. Pulling
// the bytes out to disk before the DOM is built keeps only the text in memory;
// the cards then reference an ordinary media file the exporter already knows
// how to bundle.

const IMG_DATA_URI_SRC =
  /(<img\b[^>]*?\ssrc=)(["'])data:image\/([a-z0-9.+-]+);base64,([^"']*)\2/gi;

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

export type WriteExtractedImage = (bytes: Buffer, extension: string) => string;

export interface ExtractedDataUriImages {
  html: string;
  count: number;
  bytes: number;
}

export function extractDataUriImages(
  html: string,
  writeImage: WriteExtractedImage
): ExtractedDataUriImages {
  if (!html.includes('data:image/')) {
    return { html, count: 0, bytes: 0 };
  }
  let count = 0;
  let bytes = 0;
  const unpacked = html.replace(
    IMG_DATA_URI_SRC,
    (
      match,
      prefix: string,
      quote: string,
      subtype: string,
      payload: string
    ) => {
      const extension = EXTENSION_BY_SUBTYPE.get(subtype.toLowerCase());
      if (!extension) {
        return match;
      }
      const image = Buffer.from(payload.replace(/\s+/g, ''), 'base64');
      if (image.length === 0) {
        return match;
      }
      const fileName = writeImage(image, extension);
      count += 1;
      bytes += image.length;
      return `${prefix}${quote}${fileName}${quote}`;
    }
  );
  return { html: unpacked, count, bytes };
}

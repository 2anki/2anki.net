import { isValidTextAlign } from './textAlignOptions';

export function withTextAlign(style: string | null, textAlign?: string) {
  if (style && isValidTextAlign(textAlign)) {
    style +=
      '\n' +
      `.card, .card .front-text-pre, .card .front-text-post, .card .back-text, .card .extra { text-align:${textAlign} }`;
  }
  return style;
}

import { isValidTextAlign } from './textAlignOptions';

export function withTextAlign(style: string | null, textAlign?: string) {
  if (style && isValidTextAlign(textAlign)) {
    style += '\n' + `.card { text-align:${textAlign} }`;
  }
  return style;
}

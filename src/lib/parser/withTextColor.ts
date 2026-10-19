import { isValidTextColor } from './textColorSwatches';

export function withTextColor(style: string | null, textColor?: string) {
  if (style && isValidTextColor(textColor)) {
    style += '\n' + `.card { color:${textColor} }`;
  }
  return style;
}

import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

export function transformDetailsTagToNotionToggleList(
  dom: CheerioAPI,
  details: Element[]
): Element[] {
  return details.map((detail) => {
    const wrapper = dom('<ul class="toggle"><li></li></ul>');
    wrapper.find('li').append(dom(detail));
    return wrapper[0] as Element;
  });
}

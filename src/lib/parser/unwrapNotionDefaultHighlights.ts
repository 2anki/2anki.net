import type { CheerioAPI } from 'cheerio';

// A default highlight paints nothing, but Notion's export CSS colours it near-black, which hides the text on Anki's dark canvas.
export function unwrapNotionDefaultHighlights(dom: CheerioAPI): void {
  dom('mark.highlight-default, mark[data-notion-highlight="default"]').each(
    (_index, element) => {
      const mark = dom(element);
      mark.replaceWith(mark.contents());
    }
  );
}

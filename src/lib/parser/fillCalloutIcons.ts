import type { CheerioAPI } from 'cheerio';

// Notion's current export leaves a callout's icon span empty and keeps the
// emoji in `data-emoji`, so a card showed the callout without its symbol.
export function fillCalloutIcons(dom: CheerioAPI): void {
  dom('.callout .icon[data-emoji]').each((_, element) => {
    const icon = dom(element);
    const emoji = icon.attr('data-emoji');
    if (emoji != null && emoji.length > 0 && icon.contents().length === 0) {
      icon.text(emoji);
    }
  });
}

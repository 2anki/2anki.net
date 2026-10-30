import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import sanitizeTags from '../anki/sanitizeTags';

export type SectionTagMap = Map<Element, string[]>;

function nearestToggleOwner(
  dom: CheerioAPI,
  delElement: Element
): Element | undefined {
  return dom(delElement).parents('ul.toggle').first().get(0);
}

export function collectAndStripSectionMarkers(dom: CheerioAPI): SectionTagMap {
  const owners: SectionTagMap = new Map();

  dom('ul.toggle del').each((_i: number, elem: Element) => {
    const owner = nearestToggleOwner(dom, elem);
    if (!owner) {
      return;
    }
    const tags = sanitizeTags(dom(elem).text().split(','));
    const existing = owners.get(owner) ?? [];
    owners.set(owner, [...existing, ...tags]);

    const wrapper = dom(elem).parent();
    dom(elem).remove();
    if (wrapper.is('p') && wrapper.text().trim() === '') {
      wrapper.remove();
    }
  });

  return owners;
}

export function collectSectionMarkers(dom: CheerioAPI): SectionTagMap {
  const owners: SectionTagMap = new Map();

  dom('ul.toggle del').each((_i: number, elem: Element) => {
    const owner = dom(elem).parents('details').first().get(0);
    if (!owner) {
      return;
    }
    const tags = sanitizeTags(dom(elem).text().split(','));
    owners.set(owner, [...(owners.get(owner) ?? []), ...tags]);
  });

  return owners;
}

export function enclosingToggleSectionTags(
  dom: CheerioAPI,
  element: Element,
  owners: SectionTagMap
): string[] {
  const collected: string[] = [];
  dom(element)
    .parents('details')
    .each((_i: number, ancestor: Element) => {
      collected.push(...(owners.get(ancestor) ?? []));
    });
  return [...new Set(collected)];
}

export function ancestorSectionTags(
  dom: CheerioAPI,
  toggle: Element,
  owners: SectionTagMap
): string[] {
  const collected: string[] = [];
  dom(toggle)
    .parents('ul.toggle')
    .each((_i: number, ancestor: Element) => {
      const tags = owners.get(ancestor);
      if (tags) {
        collected.push(...tags);
      }
    });
  return [...new Set(collected)];
}

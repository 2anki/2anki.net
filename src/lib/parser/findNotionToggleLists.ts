import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import CardOption from './Settings';

const MCQ_MIN_OPTIONS = 2;
const MCQ_MAX_OPTIONS = 7;

function collectListItems(element: Element, dom: CheerioAPI): Element[] {
  return dom(element)
    .find('ul.to-do-list > li, ul.bulleted-list > li')
    .toArray() as Element[];
}

function checkedTodoIndex(items: Element[], dom: CheerioAPI): number {
  const checkedIndices: number[] = [];
  items.forEach((item, idx) => {
    if (dom(item).find('.checkbox-on').length > 0) {
      checkedIndices.push(idx);
    }
  });
  if (checkedIndices.length === 1) return checkedIndices[0];
  return -1;
}

function fullyBoldedIndex(items: Element[], dom: CheerioAPI): number {
  const boldIndices: number[] = [];
  items.forEach((item, idx) => {
    const $item = dom(item);
    const strongText = $item.find('strong').text().trim();
    const itemText = $item.text().trim();
    if (strongText.length > 0 && strongText === itemText) {
      boldIndices.push(idx);
    }
  });
  if (boldIndices.length === 1) return boldIndices[0];
  return -1;
}

export function isMCQ(element: Element, dom: CheerioAPI): number {
  const items = collectListItems(element, dom);
  if (items.length < MCQ_MIN_OPTIONS || items.length > MCQ_MAX_OPTIONS)
    return -1;

  const hasTodoItems = dom(element).find('ul.to-do-list > li').length > 0;
  if (hasTodoItems) {
    return checkedTodoIndex(items, dom);
  }

  return fullyBoldedIndex(items, dom);
}

export interface MarkdownMcqResult {
  isMcqShape: boolean;
  correctIndex: number;
  options: string[];
}

function optionText($: CheerioAPI, li: Element): string {
  const $li = $(li).clone();
  $li.find('.checkbox').remove();
  return $li.text().trim();
}

export function detectNotionApiMCQ(bodyHtml: string): MarkdownMcqResult {
  const $ = cheerio.load(bodyHtml);
  const todoItems = $('ul.to-do-list > li').toArray() as Element[];
  const hasTodoItems = todoItems.length > 0;
  const listed = hasTodoItems
    ? todoItems
    : ($('ul.bulleted-list > li').toArray() as Element[]);
  const items = listed.filter((li) => optionText($, li) !== '');

  if (items.length < MCQ_MIN_OPTIONS || items.length > MCQ_MAX_OPTIONS) {
    return { isMcqShape: false, correctIndex: -1, options: [] };
  }

  const correctIndex = hasTodoItems
    ? checkedTodoIndex(items, $)
    : fullyBoldedIndex(items, $);

  const options = items.map((li) => optionText($, li));

  return { isMcqShape: true, correctIndex, options };
}

export function detectMarkdownMCQ(bodyHtml: string): MarkdownMcqResult {
  const $ = cheerio.load(bodyHtml);
  const taskItems = $('ul > li')
    .filter((_, li) => $(li).children('input[type="checkbox"]').length > 0)
    .toArray() as Element[];

  if (
    taskItems.length < MCQ_MIN_OPTIONS ||
    taskItems.length > MCQ_MAX_OPTIONS
  ) {
    return { isMcqShape: false, correctIndex: -1, options: [] };
  }

  const everyItemIsTaskItem = $('ul')
    .toArray()
    .every((ul) => {
      const lis = $(ul).children('li').toArray();
      if (lis.length === 0) return true;
      return lis.every(
        (li) => $(li).children('input[type="checkbox"]').length > 0
      );
    });
  if (!everyItemIsTaskItem) {
    return { isMcqShape: false, correctIndex: -1, options: [] };
  }

  const checkedIndices: number[] = [];
  taskItems.forEach((li, idx) => {
    const input = $(li).children('input[type="checkbox"]').first();
    if (input.length > 0 && input.is('[checked]')) {
      checkedIndices.push(idx);
    }
  });

  const options = taskItems.map((li) => {
    const $li = $(li);
    $li.find('input[type="checkbox"]').remove();
    return $li.text().trim();
  });

  const correctIndex = checkedIndices.length === 1 ? checkedIndices[0] : -1;
  return { isMcqShape: true, correctIndex, options };
}

export function findNotionToggleLists(
  dom: CheerioAPI,
  context: Pick<CardOption, 'isCherry' | 'disableIndentedBulletPoints'> & {
    isAll: boolean;
  }
): Element[] {
  if (context.isCherry) {
    return dom('.toggle').toArray();
  }
  if (context.isAll) {
    return dom('.toggle')
      .toArray()
      .filter((el) => dom(el).parents('.toggle').length === 0);
  }
  if (!context.disableIndentedBulletPoints) {
    return dom('.page-body > ul').toArray();
  }
  return dom('.page-body > ul:not(.bulleted-list)').toArray();
}

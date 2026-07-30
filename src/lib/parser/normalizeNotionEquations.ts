import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

import { escapeHtml } from '../notion-render/escape';

const INLINE_OPEN = '\\(';
const INLINE_CLOSE = '\\)';
const BLOCK_OPEN = '\\[';
const BLOCK_CLOSE = '\\]';

function extractLatex(equation: Cheerio<Element>): string | null {
  const dataAttr =
    equation.attr('data-notion-equation') ??
    equation.attr('data-notion-inline-equation');
  if (dataAttr != null && dataAttr.trim().length > 0) {
    return dataAttr.trim();
  }
  const annotation = equation
    .find('annotation[encoding="application/x-tex"]')
    .first();
  if (annotation.length === 0) {
    return null;
  }
  const latex = annotation.text().trim();
  return latex.length > 0 ? latex : null;
}

function replaceEquation(
  dom: CheerioAPI,
  element: Element,
  isBlock: boolean
): void {
  const equation = dom(element);
  const latex = extractLatex(equation);
  if (latex == null) {
    equation.find('style').remove();
    equation.replaceWith(escapeHtml(equation.text().trim()));
    return;
  }
  const open = isBlock ? BLOCK_OPEN : INLINE_OPEN;
  const close = isBlock ? BLOCK_CLOSE : INLINE_CLOSE;
  const rendered = `${open}${escapeHtml(latex)}${close}`;
  const wrapsCode = equation.find('code').length > 0;
  equation.replaceWith(wrapsCode ? `<code>${rendered}</code>` : rendered);
}

export function normalizeNotionEquations(dom: CheerioAPI): void {
  dom('figure.equation').each((_i, element) => {
    replaceEquation(dom, element, true);
  });
  dom('.notion-text-equation-token').each((_i, element) => {
    replaceEquation(dom, element, false);
  });
  dom('.katex-display').each((_i, element) => {
    replaceEquation(dom, element, true);
  });
  dom('.katex').each((_i, element) => {
    replaceEquation(dom, element, false);
  });
}

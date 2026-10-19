import fs from 'fs';
import path from 'path';
import { withTextColor } from './withTextColor';
import { withTextAlign } from './withTextAlign';

const templateDir = path.join(__dirname, '../../templates');
const customCss = fs.readFileSync(path.join(templateDir, 'custom.css'), 'utf8');
const clozeCss = fs.readFileSync(
  path.join(templateDir, 'cloze_style.css'),
  'utf8'
);
const notionCss = fs.readFileSync(path.join(templateDir, 'notion.css'), 'utf8');

const notionRedRule = /\.highlight-red\s*\{[^}]*\}/.exec(notionCss)![0];

const serverBase = `body { color: rgb(55, 53, 47) }\n${notionRedRule}\n.card {}`;

function serverStyle(hex: string, align: string): string {
  return withTextAlign(withTextColor(serverBase, hex), align)!;
}

function basicModelCss(hex: string, align: string): string {
  return serverStyle(hex, align) + customCss;
}

function clozeModelCss(hex: string, align: string): string {
  return clozeCss + '\n' + serverStyle(hex, align) + customCss;
}

interface Element {
  tag: string;
  classes: string[];
}

interface Declaration {
  selector: string;
  value: string;
  important: boolean;
  specificity: [number, number, number];
  order: number;
}

function specificity(selector: string): [number, number, number] {
  let b = 0;
  let c = 0;
  for (const compound of selector.trim().split(/\s+/)) {
    if (compound.startsWith('.')) b += 1;
    else if (compound !== '*') c += 1;
  }
  return [0, b, c];
}

function compoundMatches(compound: string, element: Element): boolean {
  if (compound === '*') return true;
  if (compound.startsWith('.'))
    return element.classes.includes(compound.slice(1));
  return element.tag === compound;
}

function selectorMatches(selector: string, chain: Element[]): boolean {
  const compounds = selector.trim().split(/\s+/);
  let ci = compounds.length - 1;
  let pi = chain.length - 1;
  if (!compoundMatches(compounds[ci], chain[pi])) return false;
  ci -= 1;
  pi -= 1;
  while (ci >= 0) {
    while (pi >= 0 && !compoundMatches(compounds[ci], chain[pi])) pi -= 1;
    if (pi < 0) return false;
    ci -= 1;
    pi -= 1;
  }
  return true;
}

function parseDeclarations(css: string, property: string): Declaration[] {
  const declarations: Declaration[] = [];
  let order = 0;
  const blockPattern = /([^{}]+)\{([^}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(css)) !== null) {
    const selectors = block[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const rawDeclarations = block[2]
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
    for (const raw of rawDeclarations) {
      const important = /!important/i.test(raw);
      const [name, ...rest] = raw.replace(/!important/i, '').split(':');
      if (name.trim() !== property) continue;
      for (const selector of selectors) {
        declarations.push({
          selector,
          value: rest.join(':').trim(),
          important,
          specificity: specificity(selector),
          order: (order += 1),
        });
      }
    }
  }
  return declarations;
}

function pickWinner(declarations: Declaration[]): Declaration {
  return declarations.slice().sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1;
    for (let i = 0; i < 3; i += 1) {
      if (a.specificity[i] !== b.specificity[i]) {
        return b.specificity[i] - a.specificity[i];
      }
    }
    return b.order - a.order;
  })[0];
}

function resolveInherited(
  css: string,
  chain: Element[],
  property: string
): Declaration | null {
  const declarations = parseDeclarations(css, property);
  for (let depth = chain.length; depth >= 1; depth -= 1) {
    const subChain = chain.slice(0, depth);
    const matching = declarations.filter((d) =>
      selectorMatches(d.selector, subChain)
    );
    if (matching.length > 0) return pickWinner(matching);
  }
  return null;
}

const body: Element = { tag: 'body', classes: [] };
const card: Element = { tag: 'div', classes: ['card'] };
const backText: Element = { tag: 'div', classes: ['back-text'] };
const frontPre: Element = { tag: 'div', classes: ['front-text-pre'] };
const extra: Element = { tag: 'div', classes: ['extra'] };
const notionRed: Element = { tag: 'span', classes: ['highlight-red'] };
const strong: Element = { tag: 'strong', classes: [] };

const RED = /color:\s*([^;}]+)/.exec(notionRedRule)![1].trim();

describe('card style cascade against the default template', () => {
  describe('text color override', () => {
    it('reaches uncolored back text on the basic model', () => {
      const css = basicModelCss('#d1242f', '');
      const winner = resolveInherited(css, [body, card, backText], 'color');
      expect(winner).toMatchObject({ value: '#d1242f', important: true });
    });

    it('reaches uncolored extra text on the cloze model', () => {
      const css = clozeModelCss('#d1242f', '');
      const winner = resolveInherited(css, [body, card, extra], 'color');
      expect(winner).toMatchObject({ value: '#d1242f', important: true });
    });

    it('leaves a Notion-colored span its own color', () => {
      const css = basicModelCss('#d1242f', '');
      const winner = resolveInherited(
        css,
        [body, card, backText, notionRed],
        'color'
      );
      expect(winner).toMatchObject({ value: RED, important: false });
    });

    it('lets bold text inside a Notion-colored span inherit that color', () => {
      const css = basicModelCss('#d1242f', '');
      const winner = resolveInherited(
        css,
        [body, card, backText, notionRed, strong],
        'color'
      );
      expect(winner).toMatchObject({ value: RED, important: false });
    });

    it('lets a block-colored toggle wrapper keep its color over the card override', () => {
      const blockColorRedRule = /\.block-color-red\s*\{[^}]*\}/.exec(
        notionCss
      )![0];
      const blockRed = /color:\s*([^;}]+)/.exec(blockColorRedRule)![1].trim();
      const base = `body { color: rgb(55, 53, 47) }\n${blockColorRedRule}\n.card {}`;
      const css = withTextColor(base, '#d1242f')! + customCss;
      const toggleWrapper: Element = {
        tag: 'div',
        classes: ['block-color-red', 'toggle'],
      };
      const winner = resolveInherited(
        css,
        [body, card, toggleWrapper],
        'color'
      );
      expect(winner).toMatchObject({ value: blockRed, important: false });
    });
  });

  describe('text align override', () => {
    it('reaches the basic back-text wrapper that the template left-aligns', () => {
      const css = basicModelCss('', 'center');
      const winner = resolveInherited(
        css,
        [body, card, backText],
        'text-align'
      );
      expect(winner?.value).toBe('center');
    });

    it('reaches the cloze extra wrapper that the template left-aligns', () => {
      const css = clozeModelCss('', 'right');
      const winner = resolveInherited(css, [body, card, extra], 'text-align');
      expect(winner?.value).toBe('right');
    });

    it('reaches the cloze front-text-pre wrapper that the template center-aligns', () => {
      const css = clozeModelCss('', 'left');
      const winner = resolveInherited(
        css,
        [body, card, frontPre],
        'text-align'
      );
      expect(winner?.value).toBe('left');
    });
  });
});

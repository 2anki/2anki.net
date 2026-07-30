import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => {
  setupTests();
});

function parse(html: string): DeckParser {
  const workspace = new Workspace(true, 'fs');
  return new DeckParser({
    name: 'equations.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'equations.html', contents: html }],
    noLimits: true,
    workspace,
  });
}

test('converts a Notion block equation on the back of a card to Anki display math', () => {
  const html = `<html><head><title>Calculus</title></head>
<body><article class="page"><h1 class="page-title">Calculus</h1><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Integral of x squared</summary>
<figure class="equation"><div contenteditable="false"><span class="katex-display"><span class="katex">
<span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow></mrow>
<annotation encoding="application/x-tex">\\int_0^1 x^2\\,dx = \\frac{1}{3}</annotation></semantics></math></span>
</span></span></div></figure>
</details></li></ul>
</div></article></body></html>`;

  const parser = parse(html);
  const back = parser.payload[0].cards[0].back;

  expect(back).toContain('\\[\\int_0^1 x^2\\,dx = \\frac{1}{3}\\]');
  expect(back).not.toContain('katex');
});

test('converts a Notion inline equation in a card summary to Anki inline math', () => {
  const html = `<html><head><title>Physics</title></head>
<body><article class="page"><h1 class="page-title">Physics</h1><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Mass energy equivalence <span class="notion-text-equation-token">
<span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow>
<annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span></span></span></summary>
<p>Einstein.</p></details></li></ul>
</div></article></body></html>`;

  const parser = parse(html);
  const front = parser.payload[0].cards[0].name;

  expect(front).toContain('\\(E = mc^2\\)');
  expect(front).not.toContain('katex');
});

// Real Notion HTML export (2026-07-23): no katex-mathml/annotation at all,
// just katex-html plus data-notion-equation(-inline)? carrying the raw LaTeX,
// and a <style>@import…katex-swap.min.css</style> inside figure.equation.
test('converts a real Notion export block equation without leaking the katex-swap CSS import', () => {
  const html = `<html><head><title>Math equations</title></head>
<body><article class="page"><h1 class="page-title">Math equations</h1><div class="page-body">
<ul class="toggle"><li><details open=""><summary>This is a math equation (block equation)</summary>
<div class="indented"><figure class="equation" data-notion-equation="E = mc^2" dir="auto"><style>@import url('https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex-swap.min.css')</style><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-html" aria-hidden="true">E=mc2</span></span></span></div></figure></div>
</details></li></ul>
</div></article></body></html>`;

  const parser = parse(html);
  const back = parser.payload[0].cards[0].back;

  expect(back).toContain('\\[E = mc^2\\]');
  expect(back).not.toContain('@import');
  expect(back).not.toContain('katex');
});

test('converts a real Notion export inline equation (no annotation present)', () => {
  const html = `<html><head><title>Math equations</title></head>
<body><article class="page"><h1 class="page-title">Math equations</h1><div class="page-body">
<ul class="toggle"><li><details open=""><summary>This a math inline equation</summary>
<div class="indented"><p><span data-notion-inline-equation=" \\Delta D_P = \\sqrt{(\\Delta x)^2 + (\\Delta y)^2}" class="notion-text-equation-token" contenteditable="false"><span class="katex"><span class="katex-html" aria-hidden="true">&#916;DP=(&#916;x)2+(&#916;y)2</span></span></span></p></div>
</details></li></ul>
</div></article></body></html>`;

  const parser = parse(html);
  const back = parser.payload[0].cards[0].back;

  expect(back).toContain(
    '\\(\\Delta D_P = \\sqrt{(\\Delta x)^2 + (\\Delta y)^2}\\)'
  );
  expect(back).not.toContain('notion-text-equation-token');
});

test('a code-wrapped inline equation in a toggle header becomes a cloze on the upload path', async () => {
  const html = `<html><head><title>Physics</title></head>
<body><article class="page sans"><header><h1 class="page-title">Physics</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary><span data-notion-inline-equation="E = mc^2" class="notion-text-equation-token" contenteditable="false"><code><span class="katex"><span class="katex-html" aria-hidden="true">E=mc2</span></span></code></span></summary>
<p>Mass energy equivalence.</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'physics.html',
    settings: new CardOption({ cherry: 'false', cloze: 'true' }),
    files: [{ name: 'physics.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);

  const card = parser.payload[0].cards[0];
  expect(card.cloze).toBe(true);
  expect(card.name).toContain('{{c1::\\(E = mc^2\\)}}');
  expect(card.name).not.toContain('<code>');
  expect(card.name).not.toContain('}}}');
});

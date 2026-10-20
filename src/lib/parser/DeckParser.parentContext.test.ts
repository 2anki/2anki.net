import path from 'path';
import fs from 'fs';

import { setupTests } from '../../test/configure-jest';
import { track } from '../../services/events/track';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Note from './Note';
import Workspace from './WorkSpace';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

beforeEach(() => {
  setupTests();
  vi.mocked(track).mockClear();
});

const CONTEXT_STYLE = 'font-size:0.8em;opacity:0.6;margin-bottom:0.35em';

const readFixture = (file: string) =>
  fs.readFileSync(path.join(__dirname, '../../test/fixtures', file)).toString();

const page = (body: string) =>
  `<html><head><title>T</title></head><body><article class="page sans"><div class="page-body">${body}</div></article></body></html>`;

const build = async (
  file: string,
  contents: string,
  options: { [key: string]: string }
) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: file,
    settings: new CardOption(options),
    files: [{ name: file, contents }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser.payload[0].cards;
};

const buildFixture = (file: string, options: { [key: string]: string }) =>
  build(file, readFixture(file), options);

const buildHtml = (body: string, options: { [key: string]: string }) =>
  build('inline.html', page(body), options);

const findCard = (cards: Note[], needle: string) =>
  cards.find((c) => c.name.includes(needle));

describe('show parent as context (Notion HTML export path)', () => {
  it('prepends the nearest enclosing bullet as a muted inline-styled line', async () => {
    const cards = await buildFixture('parent-context.html', {
      cloze: 'false',
      'parent-context': 'true',
    });

    const acs = findCard(cards, 'ACS');
    expect(acs?.name).toBe(
      `<div class="parent-context" style="${CONTEXT_STYLE}">Acute coronary syndrome</div><div class='bulleted-list'>ACS</div>`
    );
  });

  it('leaves a top-level toggle card unchanged when the option is on', async () => {
    const cards = await buildFixture('parent-context.html', {
      cloze: 'false',
      'parent-context': 'true',
    });

    const top = findCard(cards, 'Hypertension');
    expect(top?.name).not.toContain('parent-context');
  });

  it('is byte-identical to the baseline when off, including the exact front', async () => {
    const off = await buildFixture('parent-context.html', {
      cloze: 'false',
      'parent-context': 'false',
    });
    const baseline = await buildFixture('parent-context.html', {
      cloze: 'false',
    });

    expect(findCard(off, 'ACS')?.name).toBe(
      "<div class='bulleted-list'>ACS</div>"
    );
    expect(off.map((c) => ({ name: c.name, back: c.back }))).toEqual(
      baseline.map((c) => ({ name: c.name, back: c.back }))
    );
  });

  it('keeps the context when cloze mode is on', async () => {
    const cards = await buildFixture('parent-context.html', {
      'parent-context': 'true',
    });

    const acs = findCard(cards, 'ACS');
    expect(acs?.name).toContain(
      `<div class="parent-context" style="${CONTEXT_STYLE}">Acute coronary syndrome</div>`
    );
  });

  it('escapes HTML-significant characters in the parent text', async () => {
    const cards = await buildHtml(
      '<ul class="bulleted-list"><li>Risk &lt; 5% &amp; rising<ul class="toggle"><li><details open=""><summary>HR</summary><p>heart rate</p></details></li></ul></li></ul>',
      { cloze: 'false', 'parent-context': 'true' }
    );

    const card = findCard(cards, 'HR');
    expect(card?.name).toContain(
      `<div class="parent-context" style="${CONTEXT_STYLE}">Risk &lt; 5% &amp; rising</div>`
    );
    expect(card?.name).not.toContain('Risk < 5%');
  });

  it('uses the ancestor toggle on the cherry nested-toggle branch', async () => {
    const cards = await buildFixture('section-tags.html', {
      cherry: 'true',
      'parent-context': 'true',
    });

    const apple = findCard(cards, 'apple');
    expect(apple?.name).toContain(
      `<div class="parent-context" style="${CONTEXT_STYLE}">Chapter 1</div>`
    );
    const banana = findCard(cards, 'banana');
    expect(banana?.name).toContain('>Section A</div>');
  });

  it('filters cherry on the card’s own front, ignoring a cherry in the parent', async () => {
    const cards = await buildHtml(
      '<ul class="bulleted-list"><li>Topic \u{1F352}<ul class="toggle"><li><details open=""><summary>Parent cherry child</summary><p>b1</p></details></li></ul></li></ul>' +
        '<ul class="bulleted-list"><li>Plain topic<ul class="toggle"><li><details open=""><summary>Own cherry \u{1F352}</summary><p>b2</p></details></li></ul></li></ul>',
      { cloze: 'false', cherry: 'true', 'parent-context': 'true' }
    );

    expect(findCard(cards, 'Parent cherry child')).toBeUndefined();
    expect(findCard(cards, 'Own cherry')?.name).toContain('>Plain topic</div>');
  });

  it('filters avocado on the card’s own front, ignoring an avocado in the parent', async () => {
    const cards = await buildHtml(
      '<ul class="bulleted-list"><li>Draft \u{1F951}<ul class="toggle"><li><details open=""><summary>Keep me</summary><p>back</p></details></li></ul></li></ul>',
      { cloze: 'false', avocado: 'true', 'parent-context': 'true' }
    );

    const kept = findCard(cards, 'Keep me');
    expect(kept?.name).toContain('Draft \u{1F951}');
    expect(kept?.name).toContain('Keep me');
  });

  it('fires parent_context_enabled once, counting only surviving cards', async () => {
    await buildFixture('parent-context.html', {
      cloze: 'false',
      'parent-context': 'true',
    });

    expect(vi.mocked(track)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(track)).toHaveBeenCalledWith('parent_context_enabled', {
      userId: null,
      props: { cards: 1 },
    });
  });

  it('does not fire the usage event when the option is off', async () => {
    await buildFixture('parent-context.html', {
      cloze: 'false',
      'parent-context': 'false',
    });

    expect(vi.mocked(track)).not.toHaveBeenCalled();
  });
});

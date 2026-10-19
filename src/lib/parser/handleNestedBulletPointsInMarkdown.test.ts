import { handleNestedBulletPointsInMarkdown } from './handleNestedBulletPointsInMarkdown';
import CardOption from './Settings';
import CustomExporter from './exporters/CustomExporter';
import Workspace from './WorkSpace';
import os from 'os';

describe('handleNestedBulletPointsInMarkdown', () => {
  beforeAll(() => {
    process.env.WORKSPACE_BASE = os.tmpdir();
  });

  function makeDecks(
    contents: string,
    settingsOverride: Record<string, string> = {}
  ) {
    const workspace = new Workspace(true, 'fs');
    const exporter = new CustomExporter('test', workspace.location);
    const settings = new CardOption(settingsOverride);
    return handleNestedBulletPointsInMarkdown({
      name: 'test.md',
      contents,
      deckName: 'Test',
      decks: [],
      settings,
      exporter,
      workspace,
      files: [],
    });
  }

  describe('Notion toggle cards wrapped in <aside> callout (regression: #2529)', () => {
    const notionCalloutWrappingToggles = [
      '<aside>',
      '🩺 Study the following:',
      '',
      '- ▶ biliary atresia causes biliary obstruction with symptoms of (two) _',
      '    - ▶ jaundice and progressive cirrhosis',
      '- ▶ treatment for biliary atresia requires (surgical/medical) _ intervention',
      '    - ▶ surgical',
      '</aside>',
    ].join('\n');

    it('produces one card per top-level toggle row', () => {
      const decks = makeDecks(notionCalloutWrappingToggles);
      expect(decks[0].cards.length).toBe(2);
    });

    it('does not leak </aside> into any card back', () => {
      const decks = makeDecks(notionCalloutWrappingToggles);
      for (const card of decks[0].cards) {
        expect(card.back).not.toContain('aside');
        expect(card.back).not.toContain('&lt;/aside');
      }
    });

    it('preserves the ▶ content on card fronts', () => {
      const decks = makeDecks(notionCalloutWrappingToggles);
      expect(decks[0].cards[0].name).toContain('biliary atresia');
      expect(decks[0].cards[1].name).toContain('treatment');
    });

    it('preserves the ▶ content on card backs', () => {
      const decks = makeDecks(notionCalloutWrappingToggles);
      expect(decks[0].cards[0].back).toContain('jaundice');
      expect(decks[0].cards[1].back).toContain('surgical');
    });
  });

  describe('mcqEnabled card option with <aside>-wrapped content', () => {
    it('classifies MCQ cards correctly when content is wrapped in <aside>', () => {
      const contents = [
        '<aside>',
        '🩺 MCQ block:',
        '',
        '- Which treatment is first-line?',
        '    - [x] Surgical correction',
        '    - [ ] Medical management',
        '    - [ ] Watchful waiting',
        '</aside>',
      ].join('\n');

      const decks = makeDecks(contents, { 'mcq-enabled': 'true' });
      const card = decks[0].cards[0];
      expect(card.mcq).toBe(true);
      expect(card.options).toHaveLength(3);
      expect(card.correctIndices).toEqual([0]);
    });
  });

  describe('named HTML entities on card backs (regression: #3234)', () => {
    it('keeps non-breaking spaces as &nbsp; instead of re-escaping them', () => {
      const contents = [
        '- Front question',
        '    Answer&nbsp;with&nbsp;spaces',
      ].join('\n');

      const decks = makeDecks(contents);
      const back = decks[0].cards[0].back;

      expect(back).not.toContain('&amp;nbsp;');
      expect(back).not.toContain('&#xa0;');
      expect(back).toContain('&nbsp;');
    });
  });

  it('embeds images referenced in markdown', () => {
    const workspace = new Workspace(true, 'fs');
    const exporter = new CustomExporter('test', workspace.location);
    const settings = new CardOption({});
    const imageContents = Buffer.from('fake-image-data');

    const contents = [
      '- What is shown here?',
      '    ![image.png](image%201.png)',
    ].join('\n');

    const files = [{ name: 'image 1.png', contents: imageContents }];

    const decks = handleNestedBulletPointsInMarkdown({
      name: 'test.md',
      contents,
      deckName: 'Test',
      decks: [],
      settings,
      exporter,
      workspace,
      files: files as any,
    });

    const card = decks[0].cards[0];
    expect(card.media.length).toBeGreaterThan(0);
  });
  describe('YAML front matter (Obsidian / Logseq / static-site exports)', () => {
    const withFrontMatter = [
      '---',
      'title: Cardiology',
      'tags:',
      '  - med',
      '---',
      '',
      '- What supplies the SA node?',
      '    - The right coronary artery',
    ].join('\n');

    it('does not turn the front matter fences into cards', () => {
      const decks = makeDecks(withFrontMatter);
      expect(decks[0].cards).toHaveLength(1);
      expect(decks[0].cards[0].name).toContain('SA node');
    });

    it('leaves no cards at all when the body has no bullet rows', () => {
      const headingsOnly = [
        '---',
        'title: Cardiology',
        '---',
        '',
        '# Cardiology',
        '',
        'The SA node is supplied by the right coronary artery.',
      ].join('\n');

      expect(makeDecks(headingsOnly)[0].cards).toHaveLength(0);
    });

    it('names the deck from the body, not from the front matter fence', () => {
      const workspace = new Workspace(true, 'fs');
      const decks = handleNestedBulletPointsInMarkdown({
        name: 'test.md',
        contents: withFrontMatter,
        deckName: undefined,
        decks: [],
        settings: new CardOption({}),
        exporter: new CustomExporter('test', workspace.location),
        workspace,
        files: [],
      });

      expect(decks[0].name).not.toBe('---');
    });
  });

  describe('top-level bullet markers beyond dash (regression: #4834)', () => {
    it('treats - top-level bullets as card fronts', () => {
      const contents = [
        '- What supplies the SA node?',
        '    - The right coronary artery',
        '- What is the powerhouse of the cell?',
        '    - The mitochondrion',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(2);
      expect(decks[0].cards[0].name).toContain('SA node');
      expect(decks[0].cards[0].back).toContain('coronary');
      expect(decks[0].cards[1].name).toContain('powerhouse');
      expect(decks[0].cards[1].back).toContain('mitochondrion');
    });

    it('treats * top-level bullets as card fronts', () => {
      const contents = [
        '* What supplies the SA node?',
        '    * The right coronary artery',
        '* What is the powerhouse of the cell?',
        '    * The mitochondrion',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(2);
      expect(decks[0].cards[0].name).toContain('SA node');
      expect(decks[0].cards[0].back).toContain('coronary');
      expect(decks[0].cards[1].name).toContain('powerhouse');
      expect(decks[0].cards[1].back).toContain('mitochondrion');
    });

    it('treats + top-level bullets as card fronts', () => {
      const contents = [
        '+ What supplies the SA node?',
        '    + The right coronary artery',
        '+ What is the powerhouse of the cell?',
        '    + The mitochondrion',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(2);
      expect(decks[0].cards[0].name).toContain('SA node');
      expect(decks[0].cards[0].back).toContain('coronary');
      expect(decks[0].cards[1].name).toContain('powerhouse');
      expect(decks[0].cards[1].back).toContain('mitochondrion');
    });

    it('treats numbered top-level bullets as card fronts', () => {
      const contents = [
        '1. What supplies the SA node?',
        '    - The right coronary artery',
        '2. What is the powerhouse of the cell?',
        '    - The mitochondrion',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(2);
      expect(decks[0].cards[0].name).toContain('SA node');
      expect(decks[0].cards[0].back).toContain('coronary');
      expect(decks[0].cards[1].name).toContain('powerhouse');
      expect(decks[0].cards[1].back).toContain('mitochondrion');
    });

    it('treats a uniformly indented bullet list as top-level cards', () => {
      const contents = [
        '    - What supplies the SA node?',
        '        - The right coronary artery',
        '    - What is the powerhouse of the cell?',
        '        - The mitochondrion',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(2);
      expect(decks[0].cards[0].name).toContain('SA node');
      expect(decks[0].cards[1].name).toContain('powerhouse');
    });

    it('does not treat a column-0 emphasis span as a new card front', () => {
      const contents = [
        '- Question one',
        '    first back line',
        '*important closing note*',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(1);
      expect(decks[0].cards[0].back).toContain('important closing note');
    });

    it('treats a 1) numbered marker as a card front', () => {
      const contents = [
        '1) First question',
        '    First answer',
        '2) Second question',
        '    Second answer',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(2);
      expect(decks[0].cards[0].back).toContain('First answer');
      expect(decks[0].cards[1].back).toContain('Second answer');
    });

    it('does not start new cards on * * * or + + + separator rules', () => {
      const contents = [
        '* Real question',
        'Real answer stays here',
        '* * *',
        '+ + +',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(1);
      expect(decks[0].cards[0].name).toContain('Real question');
      expect(decks[0].cards[0].back).toContain('<hr');
    });

    it('keeps - bullets as cards even under a ## heading (dash is ungated)', () => {
      const contents = [
        '## Chapter 1',
        '- Question one',
        '    Answer one',
        '- Question two',
        '    Answer two',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(2);
      expect(decks[0].cards[0].name).toContain('Question one');
      expect(decks[0].cards[1].name).toContain('Question two');
    });

    it('keeps a --- rule inside a back on the same card', () => {
      const contents = [
        '- Only question',
        '    First part of the answer',
        '    ---',
        '    Second part of the answer',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(1);
      expect(decks[0].cards[0].back).toContain('First part');
      expect(decks[0].cards[0].back).toContain('Second part');
    });

    it('declines a heading-body document so the list stays on one back', () => {
      const contents = [
        '## What are the steps?',
        '',
        'Follow these:',
        '1. Boil the water',
        '2. Add the tea',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(0);
    });

    it('declines a heading-body document that uses * list markers', () => {
      const contents = [
        '## What are the options?',
        '',
        '* first option',
        '* second option',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(0);
    });

    it('keeps a prose line that begins with a year on the back under a heading', () => {
      const contents = [
        '## History',
        '',
        '1984. A pivotal year in the account.',
      ].join('\n');

      const decks = makeDecks(contents);

      expect(decks[0].cards).toHaveLength(0);
    });
  });
});

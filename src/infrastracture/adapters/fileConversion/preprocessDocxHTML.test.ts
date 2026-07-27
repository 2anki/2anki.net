import { preprocessDocxHTML } from './preprocessDocxHTML';

describe('preprocessDocxHTML', () => {
  it('converts multiple-choice questions with asterisk-marked answers to toggles', () => {
    const input =
      '<ol><li>Which leads to edema?<br />*A. blockage of lymphatic vessels<br />B. taking an antihistamine drug<br />C. A decrease in tissue fluid<br />D. All of the above</li></ol>';

    const result = preprocessDocxHTML(input);

    expect(result).toContain('<details>');
    expect(result).toContain('<summary>');
    expect(result).toContain('Which leads to edema?');
    expect(result).toContain('A. blockage of lymphatic vessels');
    expect(result).not.toContain('*A.');
  });

  it('puts the correct answer on the back of the card', () => {
    const input =
      '<ol><li>What color is the sky?<br />A. red<br />*B. blue<br />C. green</li></ol>';

    const result = preprocessDocxHTML(input);

    expect(result).toContain('<summary>');
    expect(result).toContain('What color is the sky?');
    expect(result).toContain('<strong>B. blue</strong>');
  });

  it('handles True/False questions', () => {
    const input =
      '<ol><li>Tonsils contain lymphocytes.<br />*A. True<br />B. False</li></ol>';

    const result = preprocessDocxHTML(input);

    expect(result).toContain('<summary>');
    expect(result).toContain('Tonsils contain lymphocytes.');
    expect(result).toContain('<strong>A. True</strong>');
  });

  it('handles multiple list items', () => {
    const input =
      '<ol><li>Q1?<br />*A. yes<br />B. no</li><li>Q2?<br />A. maybe<br />*B. sure</li></ol>';

    const result = preprocessDocxHTML(input);

    const toggleCount = (result.match(/<details>/g) || []).length;
    expect(toggleCount).toBe(2);
  });

  it('returns non-question HTML unchanged', () => {
    const input = '<p>Just a paragraph of text.</p>';

    const result = preprocessDocxHTML(input);

    expect(result).toBe(input);
  });

  it('preserves list items without asterisk markers as normal lists', () => {
    const input = '<ol><li>Define osmosis.</li></ol>';

    const result = preprocessDocxHTML(input);

    expect(result).not.toContain('<details>');
    expect(result).toContain('Define osmosis.');
  });

  it('handles questions where answer options use line breaks within li', () => {
    const input =
      '<ol><li>Cell-mediated immunity involves mostly<br />*A. T cells<br />B. B cells<br />C. Antibodies<br />D. Natural Killer cells</li></ol>';

    const result = preprocessDocxHTML(input);

    expect(result).toContain('Cell-mediated immunity involves mostly');
    expect(result).toContain('<strong>A. T cells</strong>');
  });

  it('converts headings followed by paragraphs into toggles when no MC questions exist', () => {
    const input =
      '<h2>Blood Vessels</h2><p>Arteries carry blood away from the heart.</p><p>Veins return blood to the heart.</p><h2>Heart Chambers</h2><p>The heart has four chambers.</p>';

    const result = preprocessDocxHTML(input);

    expect(result).toContain('<details>');
    expect(result).toContain('<summary>Blood Vessels</summary>');
    expect(result).toContain('Arteries carry blood away from the heart.');
    expect(result).toContain('<summary>Heart Chambers</summary>');
  });

  it('prefers MC questions over heading-based cards when both exist', () => {
    const input =
      '<h2>Topic</h2><p>Some info.</p><ol><li>Q1?<br />*A. yes<br />B. no</li></ol>';

    const result = preprocessDocxHTML(input);

    const toggleCount = (result.match(/<details>/g) || []).length;
    expect(toggleCount).toBe(1);
    expect(result).toContain('Q1?');
    expect(result).toContain('<h2>');
  });

  it('skips headings without following paragraph content', () => {
    const input =
      '<h1>Title Only</h1><h2>Another Heading</h2><p>Some content here.</p>';

    const result = preprocessDocxHTML(input);

    expect(result).toContain('<summary>Another Heading</summary>');
    expect(result).not.toContain('<summary>Title Only</summary>');
  });

  it('produces a card from an image-only heading with the image on the front', () => {
    const input =
      '<h2><img src="diagram.png" /></h2><p>The heart pumps blood.</p>';

    const result = preprocessDocxHTML(input);

    expect(result).toContain('<details>');
    expect(result).toContain('<summary><img src="diagram.png"></summary>');
    expect(result).toContain('The heart pumps blood.');
  });

  it('keeps both text and image on the front of an image heading', () => {
    const input =
      '<h2>Figure 1 <img src="aorta.png" /></h2><p>Largest artery in the body.</p>';

    const result = preprocessDocxHTML(input);

    expect(result).toContain(
      '<summary>Figure 1 <img src="aorta.png"></summary>'
    );
    expect(result).toContain('Largest artery in the body.');
  });

  it('produces no card from an image heading with no following body', () => {
    const input = '<h2><img src="orphan.png" /></h2><h2>Next</h2><p>Body.</p>';

    const result = preprocessDocxHTML(input);

    expect(result).not.toContain('<summary><img src="orphan.png"></summary>');
    expect(result).toContain('<h2><img src="orphan.png"></h2>');
    expect(result).toContain('<summary>Next</summary>');
  });

  it('produces byte-identical output for a plain text-only heading', () => {
    const input = '<h2>Blood Vessels</h2><p>body</p>';

    const result = preprocessDocxHTML(input);

    expect(result).toBe(
      '<html><head></head><body><details><summary>Blood Vessels</summary><p>body</p></details></body></html>'
    );
  });

  it('produces byte-identical output for a formatted text-only heading', () => {
    const input = '<h2><strong>Blood</strong> Vessels</h2><p>body</p>';

    const result = preprocessDocxHTML(input);

    expect(result).toBe(
      '<html><head></head><body><details><summary>Blood Vessels</summary><p>body</p></details></body></html>'
    );
  });
});

describe('preprocessDocxHTML bullet fan-out', () => {
  const sectionHTML =
    '<h2>Contract remedies</h2>' +
    '<ul>' +
    '<li>Damages compensate the injured party</li>' +
    '<li>Specific performance forces the promised act</li>' +
    '<li>Rescission unwinds the contract</li>' +
    '</ul>';

  it('emits one toggle per bullet with a positional cue on the front', () => {
    const result = preprocessDocxHTML(sectionHTML, { bulletFanOut: true });

    expect(result).toContain('<summary>Contract remedies — 1/3</summary>');
    expect(result).toContain('<summary>Contract remedies — 2/3</summary>');
    expect(result).toContain('<summary>Contract remedies — 3/3</summary>');
    expect(result).toContain(
      '<details><summary>Contract remedies — 1/3</summary>Damages compensate the injured party</details>'
    );
    expect((result.match(/<details>/g) || []).length).toBe(3);
  });

  it('keeps non-list content under the heading as its own card', () => {
    const input =
      '<h2>Contract remedies</h2>' +
      '<p>Remedies restore the injured party.</p>' +
      '<ul><li>Damages</li><li>Rescission</li></ul>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect(result).toContain(
      '<details><summary>Contract remedies</summary><p>Remedies restore the injured party.</p></details>'
    );
    expect(result).toContain('<summary>Contract remedies — 1/2</summary>');
    expect(result).toContain('<summary>Contract remedies — 2/2</summary>');
  });

  it('keeps a single bullet without a positional cue', () => {
    const input = '<h2>Rule</h2><ul><li>Only one point</li></ul>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect(result).toContain(
      '<details><summary>Rule</summary>Only one point</details>'
    );
    expect(result).not.toContain('1/1');
  });

  it('preserves nested lists inside a bullet on that card back', () => {
    const input =
      '<h2>Topic</h2>' +
      '<ul><li>Parent point<ul><li>child detail</li></ul></li><li>Second</li></ul>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect(result).toContain(
      '<details><summary>Topic — 1/2</summary>Parent point<ul><li>child detail</li></ul></details>'
    );
  });

  it('keeps the image-heading model with the cue after the image', () => {
    const input =
      '<h2><img src="figure.png" /></h2><ul><li>First</li><li>Second</li></ul>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect(result).toContain('<summary><img src="figure.png"> — 1/2</summary>');
  });

  it('leaves the lumped section shape unchanged without the flag', () => {
    const result = preprocessDocxHTML(sectionHTML);

    expect((result.match(/<details>/g) || []).length).toBe(1);
    expect(result).toContain('<summary>Contract remedies</summary>');
  });

  it('does not touch the MCQ flashcard preprocessing path', () => {
    const input = '<ul><li>Question?<br />A. wrong<br />*B. right</li></ul>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect(result).toContain('<strong>B. right</strong>');
  });
});

describe('preprocessDocxHTML paragraph fan-out', () => {
  const phrasebookHTML =
    '<h2>Greetings</h2>' +
    '<p>Good morning — Buongiorno</p>' +
    '<p>Good evening — Buonasera</p>' +
    '<p>How are you? — Come stai?</p>' +
    '<p>See you later — A dopo</p>';

  it('fans a run of short paragraphs into one card per paragraph', () => {
    const result = preprocessDocxHTML(phrasebookHTML, { bulletFanOut: true });

    expect(result).toContain(
      '<details><summary>Greetings — 1/4</summary>Good morning — Buongiorno</details>'
    );
    expect(result).toContain('<summary>Greetings — 4/4</summary>');
    expect((result.match(/<details>/g) || []).length).toBe(4);
  });

  it('keeps a section under four short paragraphs as one card', () => {
    const input =
      '<h2>Notes</h2>' +
      '<p>First point.</p>' +
      '<p>Second point.</p>' +
      '<p>Third point.</p>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect((result.match(/<details>/g) || []).length).toBe(1);
    expect(result).toContain('<summary>Notes</summary>');
  });

  it('keeps a section of long prose paragraphs as one card', () => {
    const prose = 'This paragraph explains a concept in depth. '.repeat(6);
    const input =
      '<h2>Theory</h2>' +
      `<p>${prose}</p><p>${prose}</p><p>${prose}</p><p>${prose}</p>`;

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect((result.match(/<details>/g) || []).length).toBe(1);
    expect(result).toContain('<summary>Theory</summary>');
  });

  it('puts one long intro paragraph on a context card and fans the rest', () => {
    const intro = 'An introductory explanation of the greetings below. '.repeat(
      5
    );
    const input =
      `<h2>Greetings</h2><p>${intro.trim()}</p>` +
      '<p>Good morning — Buongiorno</p>' +
      '<p>Good evening — Buonasera</p>' +
      '<p>How are you? — Come stai?</p>' +
      '<p>See you later — A dopo</p>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect(result).toContain('<details><summary>Greetings</summary><p>');
    expect(result).toContain('<summary>Greetings — 1/4</summary>');
    expect((result.match(/<details>/g) || []).length).toBe(5);
  });

  it('skips empty and whitespace-only paragraphs without emitting blank cards', () => {
    const input =
      '<h2>Greetings</h2>' +
      '<p>Good morning — Buongiorno</p>' +
      '<p></p>' +
      '<p>&nbsp;</p>' +
      '<p>Good evening — Buonasera</p>' +
      '<p>How are you? — Come stai?</p>' +
      '<p>See you later — A dopo</p>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect((result.match(/<details>/g) || []).length).toBe(4);
    expect(result).toContain('<summary>Greetings — 4/4</summary>');
  });

  it('falls back to one lumped card when the section contains an image', () => {
    const input =
      '<h2>Diagrams</h2>' +
      '<p>Label one</p>' +
      '<p><img src="figure.png" /></p>' +
      '<p>Label two</p>' +
      '<p>Label three</p>' +
      '<p>Label four</p>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect((result.match(/<details>/g) || []).length).toBe(1);
    expect(result).toContain('<img src="figure.png">');
  });

  it('falls back to one lumped card when the section contains a table', () => {
    const input =
      '<h2>Verbs</h2>' +
      '<p>To be — essere</p>' +
      '<p>To have — avere</p>' +
      '<table><tr><td>io</td><td>sono</td></tr></table>' +
      '<p>To go — andare</p>' +
      '<p>To do — fare</p>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect((result.match(/<details>/g) || []).length).toBe(1);
  });

  it('preserves inline formatting on fanned-out paragraph cards', () => {
    const input =
      '<h2>Terms</h2>' +
      '<p><strong>Osmosis</strong> — passive water movement</p>' +
      '<p><strong>Diffusion</strong> — passive solute movement</p>' +
      '<p><strong>Active transport</strong> — energy-dependent movement</p>' +
      '<p><strong>Endocytosis</strong> — bulk intake</p>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect(result).toContain(
      '<details><summary>Terms — 1/4</summary><strong>Osmosis</strong> — passive water movement</details>'
    );
  });

  it('does not hijack a section that already has real bullets', () => {
    const input =
      '<h2>Mixed</h2>' +
      '<p>Intro one</p>' +
      '<p>Intro two</p>' +
      '<p>Intro three</p>' +
      '<p>Intro four</p>' +
      '<ul><li>Bullet A</li><li>Bullet B</li></ul>';

    const result = preprocessDocxHTML(input, { bulletFanOut: true });

    expect(result).toContain('<summary>Mixed — 1/2</summary>');
    expect(result).toContain(
      '<details><summary>Mixed</summary><p>Intro one</p><p>Intro two</p><p>Intro three</p><p>Intro four</p></details>'
    );
    expect((result.match(/<details>/g) || []).length).toBe(3);
  });

  it('does not fan out paragraphs when the flag is off', () => {
    const result = preprocessDocxHTML(phrasebookHTML);

    expect((result.match(/<details>/g) || []).length).toBe(1);
  });
});

import * as cheerio from 'cheerio';
import { induceCardsFromDom, domPlainTextLength } from './induceCardsFromDom';

function load(inner: string) {
  return cheerio.load(`<div class="page-body">${inner}</div>`);
}

describe('induceCardsFromDom', () => {
  it('pairs headings with their following content', () => {
    const dom = load(`
      <h2>What is osmosis?</h2>
      <p>Water crossing a membrane.</p>
      <h2>What is diffusion?</h2>
      <p>Particles spreading out.</p>
      <h2>What is mitosis?</h2>
      <p>Cell division.</p>
    `);

    const notes = induceCardsFromDom(dom, 'heading');

    expect(notes).toHaveLength(3);
    expect(notes[0].name).toContain('osmosis');
    expect(notes[0].back).toContain('membrane');
  });

  it('keeps a bold term inside a bullet bold in the rescued card', () => {
    const dom = load(`
      <ul>
        <li><strong>Photosynthesis</strong><ul><li>Converts light into energy.</li></ul></li>
        <li><strong>Respiration</strong><ul><li>Releases energy from glucose.</li></ul></li>
        <li><strong>Osmosis</strong><ul><li>Water across a membrane.</li></ul></li>
      </ul>
    `);

    const notes = induceCardsFromDom(dom, 'bullets');

    expect(notes).toHaveLength(3);
    expect(notes[0].name).toContain('<strong>Photosynthesis</strong>');
    expect(notes[0].back).toContain('Converts light');
  });

  it('builds a card per two-cell table row and keeps cell formatting', () => {
    const dom = load(`
      <table>
        <tr><td>Osmosis</td><td>Water crossing a <strong>membrane</strong></td></tr>
        <tr><td>Diffusion</td><td>Particles spreading out</td></tr>
        <tr><td>Mitosis</td><td>Cell division</td></tr>
      </table>
    `);

    const notes = induceCardsFromDom(dom, 'columns');

    expect(notes).toHaveLength(3);
    expect(notes[0].name).toBe('Osmosis');
    expect(notes[0].back).toContain('<strong>membrane</strong>');
  });

  it('does not offer a single-cell table row', () => {
    const dom = load(`
      <table>
        <tr><td>Only one cell</td></tr>
        <tr><td>Another lonely cell</td></tr>
      </table>
    `);

    expect(induceCardsFromDom(dom, 'columns')).toHaveLength(0);
  });

  it('pairs an English Q:/A: shape and keeps a formatted answer', () => {
    const dom = load(`
      <p>Q: What is the cell wall?</p>
      <p>A: It <strong>protects</strong> the cell.</p>
    `);

    const notes = induceCardsFromDom(dom, 'guess');

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe('What is the cell wall?');
    expect(notes[0].name).not.toContain('Q:');
    expect(notes[0].back).toContain('<strong>protects</strong>');
  });

  it('pairs a German F:/A: shape', () => {
    const dom = load(`
      <p>F: Was ist die Zellwand?</p>
      <p>A: Sie schützt die Zelle.</p>
    `);

    const notes = induceCardsFromDom(dom, 'guess');

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe('Was ist die Zellwand?');
    expect(notes[0].back).toContain('schützt');
  });

  it('splits a term::definition line while preserving bold', () => {
    const dom = load(
      `<p>Osmosis::water crossing a <strong>membrane</strong></p>`
    );

    const notes = induceCardsFromDom(dom, 'guess');

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe('Osmosis');
    expect(notes[0].back).toContain('<strong>membrane</strong>');
  });

  it('does not treat ordinary paragraphs as marker cards', () => {
    const dom = load(`
      <p>Photosynthesis converts light energy.</p>
      <p>Respiration releases stored energy.</p>
    `);

    expect(induceCardsFromDom(dom, 'guess')).toHaveLength(0);
  });

  it('strips a marker that sits inside an inline element', () => {
    const dom = load(`
      <p><strong>Q:</strong> What is osmosis?</p>
      <p>A: Water crossing a <strong>membrane</strong>.</p>
    `);

    const notes = induceCardsFromDom(dom, 'guess');

    expect(notes).toHaveLength(1);
    expect(notes[0].name).not.toContain('Q:');
    expect(notes[0].name).toContain('What is osmosis?');
    expect(notes[0].back).toContain('<strong>membrane</strong>');
  });

  it('does not split on :: that appears only inside markup', () => {
    const dom = load(
      `<p>See the <a href="http://x/a::b">reference</a> page.</p>`
    );
    expect(induceCardsFromDom(dom, 'guess')).toHaveLength(0);
  });

  it('does not pair MCQ option labels (Q. / A. / B.) as cards', () => {
    const dom = load(`
      <p>Q. What is the capital of France?</p>
      <p>A. London</p>
      <p>B. Berlin</p>
      <p>C. Paris</p>
    `);

    expect(induceCardsFromDom(dom, 'guess')).toHaveLength(0);
  });

  it('pairs Q:/A: across an empty block between them', () => {
    const dom = load(`
      <p>Q: What is diffusion?</p>
      <hr />
      <p>A: Particles spreading out.</p>
    `);

    const notes = induceCardsFromDom(dom, 'guess');

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe('What is diffusion?');
    expect(notes[0].back).toBe('Particles spreading out.');
  });

  it('joins the third column into the back and skips a header row', () => {
    const dom = load(`
      <table>
        <thead><tr><th>Term</th><th>Definition</th><th>Example</th></tr></thead>
        <tbody>
          <tr><td>Osmosis</td><td>Water across a membrane</td><td>Roots</td></tr>
          <tr><td>Diffusion</td><td>High to low</td><td>Perfume</td></tr>
          <tr><td>Mitosis</td><td>Cell division</td><td>Growth</td></tr>
        </tbody>
      </table>
    `);

    const notes = induceCardsFromDom(dom, 'columns');

    expect(notes).toHaveLength(3);
    expect(notes[0].name).toBe('Osmosis');
    expect(notes[0].back).toContain('Water across a membrane');
    expect(notes[0].back).toContain('Roots');
  });

  it('does not turn a nested table row into a duplicate card', () => {
    const dom = load(`
      <table>
        <tr>
          <td>Outer term</td>
          <td>
            <table><tr><td>inner a</td><td>inner b</td></tr></table>
          </td>
        </tr>
        <tr><td>Second term</td><td>Second definition</td></tr>
        <tr><td>Third term</td><td>Third definition</td></tr>
      </table>
    `);

    const notes = induceCardsFromDom(dom, 'columns');

    expect(notes.map((note) => note.name)).toEqual([
      'Outer term',
      'Second term',
      'Third term',
    ]);
  });

  it('measures the plain-text length of the page body', () => {
    const dom = load(`<p>abcdef</p>`);
    expect(domPlainTextLength(dom)).toBe(6);
  });
});

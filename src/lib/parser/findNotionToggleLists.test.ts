import * as cheerio from 'cheerio';
import { detectNotionApiMCQ, isMCQ } from './findNotionToggleLists';

function loadToggleDetails(html: string) {
  const dom = cheerio.load(html);
  const details = dom('details').first();
  return { dom, details: details.get(0)! };
}

describe('isMCQ', () => {
  test('returns checked index for toggle with one checked to-do item', () => {
    const { dom, details } = loadToggleDetails(`
      <details>
        <summary>What is 2+2?</summary>
        <ul class="to-do-list">
          <li><span class="checkbox checkbox-off"></span>3</li>
          <li><span class="checkbox checkbox-on"></span>4</li>
          <li><span class="checkbox checkbox-off"></span>5</li>
          <li><span class="checkbox checkbox-off"></span>6</li>
        </ul>
      </details>
    `);
    expect(isMCQ(details, dom)).toBe(1);
  });

  test('returns bold index for toggle with one fully-bolded bulleted item (fallback)', () => {
    const { dom, details } = loadToggleDetails(`
      <details>
        <summary>What is the capital of France?</summary>
        <ul class="bulleted-list">
          <li style="list-style-type:disc">London</li>
          <li style="list-style-type:disc"><strong>Paris</strong></li>
          <li style="list-style-type:disc">Berlin</li>
          <li style="list-style-type:disc">Madrid</li>
        </ul>
      </details>
    `);
    expect(isMCQ(details, dom)).toBe(1);
  });

  test('returns -1 when zero checked to-do boxes and no bold option', () => {
    const { dom, details } = loadToggleDetails(`
      <details>
        <summary>What is 2+2?</summary>
        <ul class="to-do-list">
          <li><span class="checkbox checkbox-off"></span>3</li>
          <li><span class="checkbox checkbox-off"></span>4</li>
          <li><span class="checkbox checkbox-off"></span>5</li>
          <li><span class="checkbox checkbox-off"></span>6</li>
        </ul>
      </details>
    `);
    expect(isMCQ(details, dom)).toBe(-1);
  });

  test('returns -1 when two or more to-do boxes are checked (ambiguous)', () => {
    const { dom, details } = loadToggleDetails(`
      <details>
        <summary>Ambiguous question?</summary>
        <ul class="to-do-list">
          <li><span class="checkbox checkbox-on"></span>A</li>
          <li><span class="checkbox checkbox-on"></span>B</li>
          <li><span class="checkbox checkbox-off"></span>C</li>
        </ul>
      </details>
    `);
    expect(isMCQ(details, dom)).toBe(-1);
  });

  test('returns -1 when only one option (not an MCQ)', () => {
    const { dom, details } = loadToggleDetails(`
      <details>
        <summary>Just one?</summary>
        <ul class="to-do-list">
          <li><span class="checkbox checkbox-on"></span>Only option</li>
        </ul>
      </details>
    `);
    expect(isMCQ(details, dom)).toBe(-1);
  });

  test('returns -1 when 8 or more options (exceeds cap)', () => {
    const items = Array.from(
      { length: 8 },
      (_, i) =>
        `<li><span class="checkbox ${i === 0 ? 'checkbox-on' : 'checkbox-off'}"></span>Option ${i + 1}</li>`
    ).join('');
    const { dom, details } = loadToggleDetails(`
      <details>
        <summary>Too many options?</summary>
        <ul class="to-do-list">${items}</ul>
      </details>
    `);
    expect(isMCQ(details, dom)).toBe(-1);
  });

  test('todo checked takes precedence over bold when both present', () => {
    const { dom, details } = loadToggleDetails(`
      <details>
        <summary>Precedence test?</summary>
        <ul class="to-do-list">
          <li><span class="checkbox checkbox-off"></span><strong>A (bold but unchecked)</strong></li>
          <li><span class="checkbox checkbox-on"></span>B (checked)</li>
          <li><span class="checkbox checkbox-off"></span>C</li>
        </ul>
      </details>
    `);
    expect(isMCQ(details, dom)).toBe(1);
  });

  test('returns -1 when no list children at all', () => {
    const { dom, details } = loadToggleDetails(`
      <details>
        <summary>No options</summary>
        <p>Just a paragraph.</p>
      </details>
    `);
    expect(isMCQ(details, dom)).toBe(-1);
  });
});

describe('detectNotionApiMCQ', () => {
  test('detects the checked to-do shape the live API renders', () => {
    const result = detectNotionApiMCQ(`
      <ul class="to-do-list">
        <li><div class="checkbox checkbox-off"></div>Three</li>
        <li><div class="checkbox checkbox-on"></div>Four</li>
        <li><div class="checkbox checkbox-off"></div>Five</li>
      </ul>
    `);
    expect(result).toEqual({
      isMcqShape: true,
      correctIndex: 1,
      options: ['Three', 'Four', 'Five'],
    });
  });

  test('detects the fully-bolded bulleted shape the live API renders', () => {
    const result = detectNotionApiMCQ(`
      <ul class="bulleted-list">
        <li><div>London</div></li>
        <li><div><strong>Paris</strong></div></li>
        <li><div>Berlin</div></li>
      </ul>
    `);
    expect(result).toEqual({
      isMcqShape: true,
      correctIndex: 1,
      options: ['London', 'Paris', 'Berlin'],
    });
  });

  test('leaves a plain bulleted list without a bold option unclassified', () => {
    const result = detectNotionApiMCQ(`
      <ul class="bulleted-list">
        <li><div>London</div></li>
        <li><div>Paris</div></li>
        <li><div>Berlin</div></li>
      </ul>
    `);
    expect(result.correctIndex).toBe(-1);
  });

  test('returns -1 when more than one bulleted option is fully bolded', () => {
    const result = detectNotionApiMCQ(`
      <ul class="bulleted-list">
        <li><div><strong>London</strong></div></li>
        <li><div><strong>Paris</strong></div></li>
        <li><div>Berlin</div></li>
      </ul>
    `);
    expect(result.correctIndex).toBe(-1);
  });

  test('prefers the to-do shape when both shapes are present', () => {
    const result = detectNotionApiMCQ(`
      <ul class="to-do-list">
        <li><div class="checkbox checkbox-off"></div><strong>A</strong></li>
        <li><div class="checkbox checkbox-on"></div>B</li>
      </ul>
      <ul class="bulleted-list">
        <li><div><strong>C</strong></div></li>
        <li><div>D</div></li>
      </ul>
    `);
    expect(result.correctIndex).toBe(1);
    expect(result.options).toEqual(['A', 'B']);
  });
});

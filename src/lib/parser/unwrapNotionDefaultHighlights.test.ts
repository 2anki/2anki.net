import * as cheerio from 'cheerio';

import { unwrapNotionDefaultHighlights } from './unwrapNotionDefaultHighlights';

const unwrap = (html: string) => {
  const dom = cheerio.load(html);
  unwrapNotionDefaultHighlights(dom);
  return dom('body').html();
};

describe('unwrapNotionDefaultHighlights', () => {
  it('unwraps the mark Notion writes around text with a default highlight', () => {
    expect(
      unwrap(
        `<div class="toggle"><mark class="highlight-default" data-notion-highlight="default">Capital of Albania?</mark></div>`
      )
    ).toBe(`<div class="toggle">Capital of Albania?</div>`);
  });

  it('keeps inline formatting that sits inside the mark', () => {
    expect(
      unwrap(
        `<p><mark class="highlight-default"><strong>Tirana</strong> is the capital</mark></p>`
      )
    ).toBe(`<p><strong>Tirana</strong> is the capital</p>`);
  });

  it('unwraps a mark that only carries the data attribute', () => {
    expect(
      unwrap(`<p><mark data-notion-highlight="default">Tirana</mark></p>`)
    ).toBe(`<p>Tirana</p>`);
  });

  it('unwraps every default mark in the page', () => {
    const html = unwrap(
      `<p><mark class="highlight-default">one</mark> and <mark class="highlight-default">two</mark></p>`
    );
    expect(html).toBe(`<p>one and two</p>`);
  });

  it('unwraps nested default marks', () => {
    expect(
      unwrap(
        `<p><mark class="highlight-default">a <mark class="highlight-default">b</mark> c</mark></p>`
      )
    ).toBe(`<p>a b c</p>`);
  });

  it('unwraps a mark inside a toggle summary', () => {
    expect(
      unwrap(
        `<details><summary><mark class="highlight-default">Question?</mark></summary><p>Answer</p></details>`
      )
    ).toBe(`<details><summary>Question?</summary><p>Answer</p></details>`);
  });

  it('unwraps a mark inside a table cell', () => {
    expect(
      unwrap(
        `<table><tbody><tr><td><mark class="highlight-default">cell</mark></td></tr></tbody></table>`
      )
    ).toBe(`<table><tbody><tr><td>cell</td></tr></tbody></table>`);
  });

  it('keeps a colour highlight that sits inside a default mark', () => {
    expect(
      unwrap(
        `<p><mark class="highlight-default">a <mark class="highlight-yellow_background">b</mark></mark></p>`
      )
    ).toBe(`<p>a <mark class="highlight-yellow_background">b</mark></p>`);
  });

  it('leaves a real colour highlight alone', () => {
    const html = `<p><mark class="highlight-yellow_background">Tirana</mark></p>`;
    expect(unwrap(html)).toBe(html);
  });

  it('leaves a coloured text mark alone', () => {
    const html = `<p><mark class="highlight-red">Tirana</mark></p>`;
    expect(unwrap(html)).toBe(html);
  });
});

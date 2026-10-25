import { splitLargeHtml } from './splitLargeHtml';

const small = { aboveBytes: 100, chunkBytes: 200 };

function page(children: string): string {
  return `<html><head><title>Big</title></head><body><article><div class="page-body">${children}</div></article></body></html>`;
}

function toggle(n: number): string {
  return `<ul class="toggle"><li><details><summary>Front ${n}</summary><p>Back ${n} ${'x'.repeat(40)}</p></details></li></ul>`;
}

function countOf(parts: string[], needle: string): number {
  return parts.join('').split(needle).length - 1;
}

describe('splitLargeHtml', () => {
  it('leaves a page below the threshold alone', () => {
    expect(splitLargeHtml(page(toggle(1)))).toBeNull();
  });

  it('splits between top level elements and keeps every one whole', () => {
    const children = Array.from({ length: 12 }, (_, i) => toggle(i)).join('');
    const parts = splitLargeHtml(page(children), small);

    expect(parts).not.toBeNull();
    expect(parts!.length).toBeGreaterThan(1);
    for (const part of parts!) {
      expect(part.split('<details>').length).toBe(
        part.split('</details>').length
      );
      expect(part).toContain('<title>Big</title>');
      expect(part.endsWith('</div></article></body></html>')).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      expect(countOf(parts!, `Front ${i}<`)).toBe(1);
    }
  });

  it('does not cut inside a nested element', () => {
    const nested = `<ul class="toggle"><li><details><summary>Outer</summary>${toggle(1).repeat(8)}</details></li></ul>`;
    const parts = splitLargeHtml(page(nested + toggle(2)), small);

    expect(parts).not.toBeNull();
    expect(parts![0]).toContain('<summary>Outer</summary>');
    expect(parts![0]).toContain('</details></li></ul></div>');
  });

  it('ignores tags inside scripts, comments and quoted attributes', () => {
    const children =
      '<script>var a = "<div>";</script><!-- <div> --><p title="a > b <div>">text</p>' +
      Array.from({ length: 10 }, (_, i) => toggle(i)).join('');
    const parts = splitLargeHtml(page(children), small);

    expect(parts).not.toBeNull();
    expect(parts!.length).toBeGreaterThan(1);
    expect(countOf(parts!, 'Front 9<')).toBe(1);
  });

  it('treats void and self closing tags at the top as complete elements', () => {
    const children = Array.from(
      { length: 10 },
      (_, i) => `${toggle(i)}<hr><br/><img src="a.png">`
    ).join('');
    const parts = splitLargeHtml(page(children), small);

    expect(parts).not.toBeNull();
    expect(countOf(parts!, '<hr>')).toBe(10);
  });

  it('falls back to the body when there is no page body', () => {
    const html = `<html><head></head><body>${Array.from({ length: 10 }, (_, i) => toggle(i)).join('')}</body></html>`;
    const parts = splitLargeHtml(html, small);

    expect(parts).not.toBeNull();
    expect(countOf(parts!, 'Front 9<')).toBe(1);
  });

  it('gives up when the markup never closes', () => {
    expect(
      splitLargeHtml(
        `<html><body><div class="page-body">${toggle(1).repeat(10)}`,
        small
      )
    ).toBeNull();
  });

  it('returns nothing when the page is one element', () => {
    const one = `<ul class="toggle"><li>${'<p>text</p>'.repeat(30)}</li></ul>`;
    expect(splitLargeHtml(page(one), small)).toBeNull();
  });

  it('gives up at once on an unterminated tag instead of rescanning the page', () => {
    const children = `${toggle(1)}${'<a href="x '.repeat(100000)}`;
    const started = Date.now();

    expect(splitLargeHtml(page(children), small)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('treats a bare less-than sign in text as text', () => {
    const children = Array.from(
      { length: 10 },
      (_, i) => `<p>1 < 2 and 3 <4</p>${toggle(i)}`
    ).join('');
    const parts = splitLargeHtml(page(children), small);

    expect(parts).not.toBeNull();
    expect(countOf(parts!, 'Front 9<')).toBe(1);
  });
});

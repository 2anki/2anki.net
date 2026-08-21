import { describe, expect, it } from 'vitest';

import { AnkiNoteType } from '../../lib/backend/templates';
import { buildPreviewDocument, renderCardSide } from './renderNoteTypePreview';

const basic: AnkiNoteType = {
  id: 1,
  name: 'Basic',
  type: 0,
  tmpls: [
    {
      name: 'Card 1',
      ord: 0,
      qfmt: '{{Front}}',
      afmt: '{{FrontSide}}<hr>{{Back}}',
    },
  ],
  flds: [
    { name: 'Front', ord: 0 },
    { name: 'Back', ord: 1 },
  ],
  css: '.card { color: black; }',
};

const cloze: AnkiNoteType = {
  ...basic,
  type: 1,
  tmpls: [
    {
      name: 'Cloze',
      ord: 0,
      qfmt: '{{cloze:Text}}',
      afmt: '{{cloze:Text}}<br>{{Extra}}',
    },
  ],
  flds: [
    { name: 'Text', ord: 0 },
    { name: 'Extra', ord: 1 },
  ],
};

describe('renderCardSide', () => {
  it('renders with empty values when previewData is missing entirely', () => {
    const result = renderCardSide(
      basic,
      undefined as unknown as Record<string, string>,
      'front'
    );
    expect(result).toBe('');
  });

  it('builds a document for a starter with no previewData', () => {
    const doc = buildPreviewDocument(
      basic,
      undefined as unknown as Record<string, string>,
      'back'
    );
    expect(doc).toContain('<div class="card">');
  });

  it('substitutes simple {{Field}} placeholders on the front', () => {
    const result = renderCardSide(
      basic,
      { Front: 'Hello', Back: 'World' },
      'front'
    );
    expect(result).toBe('Hello');
  });

  it('substitutes {{FrontSide}} on the back', () => {
    const result = renderCardSide(basic, { Front: 'Q', Back: 'A' }, 'back');
    expect(result).toContain('Q');
    expect(result).toContain('A');
    expect(result).not.toContain('{{FrontSide}}');
  });

  it('renders cloze placeholders on the front', () => {
    const result = renderCardSide(
      cloze,
      { Text: 'The capital of {{c1::France}} is {{c2::Paris}}', Extra: '' },
      'front'
    );
    expect(result).toContain('The capital of');
    expect(result).toContain('[&hellip;]');
    expect(result).not.toContain('France');
    expect(result).not.toContain('Paris');
  });

  it('reveals cloze answers on the back', () => {
    const result = renderCardSide(
      cloze,
      { Text: 'Capital of {{c1::France}}', Extra: '' },
      'back'
    );
    expect(result).toContain('France');
    expect(result).not.toContain('{{c1');
  });

  it('drops unknown fields silently', () => {
    const result = renderCardSide(basic, { Front: 'Q', Back: 'A' }, 'front');
    expect(result).not.toContain('{{');
  });

  it('returns an empty string when the note type has no templates', () => {
    const empty: AnkiNoteType = { ...basic, tmpls: [] };
    expect(renderCardSide(empty, {}, 'front')).toBe('');
  });
});

describe('conditional blocks', () => {
  const conditional: AnkiNoteType = {
    ...basic,
    tmpls: [
      {
        name: 'Card 1',
        ord: 0,
        qfmt: '{{#Header}}<h1>{{Header}}</h1>{{/Header}}{{Front}}',
        afmt: '{{FrontSide}}{{#Back Extra}}<aside>{{Back Extra}}</aside>{{/Back Extra}}',
      },
    ],
    flds: [
      { name: 'Header', ord: 0 },
      { name: 'Front', ord: 1 },
      { name: 'Back Extra', ord: 2 },
    ],
  };

  it('renders {{#Field}}...{{/Field}} content when the field is non-empty', () => {
    const result = renderCardSide(
      conditional,
      { Header: 'Cell anatomy', Front: 'Q', 'Back Extra': '' },
      'front'
    );
    expect(result).toContain('<h1>Cell anatomy</h1>');
    expect(result).not.toContain('{{#Header}}');
    expect(result).not.toContain('{{/Header}}');
  });

  it('removes {{#Field}}...{{/Field}} content when the field is empty', () => {
    const result = renderCardSide(
      conditional,
      { Header: '', Front: 'Q', 'Back Extra': '' },
      'front'
    );
    expect(result).not.toContain('<h1>');
    expect(result).not.toContain('{{#Header}}');
    expect(result).toBe('Q');
  });

  it('substitutes field names that contain spaces', () => {
    const result = renderCardSide(
      conditional,
      { Header: '', Front: 'Q', 'Back Extra': 'Mitochondria' },
      'back'
    );
    expect(result).toContain('<aside>Mitochondria</aside>');
    expect(result).not.toContain('{{Back Extra}}');
  });

  it('handles {{^Field}}...{{/Field}} inverse — renders when empty, hides when present', () => {
    const inverse: AnkiNoteType = {
      ...basic,
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{^Hint}}<em>no hint</em>{{/Hint}}{{Front}}',
          afmt: '{{Back}}',
        },
      ],
      flds: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
        { name: 'Hint', ord: 2 },
      ],
    };
    const empty = renderCardSide(
      inverse,
      { Front: 'Q', Back: 'A', Hint: '' },
      'front'
    );
    expect(empty).toContain('<em>no hint</em>');
    const filled = renderCardSide(
      inverse,
      { Front: 'Q', Back: 'A', Hint: 'something' },
      'front'
    );
    expect(filled).not.toContain('<em>no hint</em>');
  });

  it('strips conditional tokens that reference unknown fields', () => {
    const result = renderCardSide(conditional, { Front: 'Q' }, 'front');
    expect(result).not.toContain('{{#');
    expect(result).not.toContain('{{/');
    expect(result).toBe('Q');
  });
});

describe('buildPreviewDocument', () => {
  it('wraps the rendered side in a sandbox-friendly HTML document', () => {
    const doc = buildPreviewDocument(basic, { Front: 'Q', Back: 'A' }, 'front');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<style>');
    expect(doc).toContain('.card { color: black; }');
    expect(doc).toContain('<div class="card">Q</div>');
  });

  it('stubs the anki global before the card body so image-occlusion setup cannot throw', () => {
    const imageOcclusion: AnkiNoteType = {
      ...basic,
      name: 'Image Occlusion',
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '<div id="err"></div><script>try{anki.imageOcclusion.setup();}catch(e){document.getElementById("err").innerHTML=`Error loading image occlusion.<br><br>${e}`;}</script>',
          afmt: '{{FrontSide}}',
        },
      ],
    };
    const doc = buildPreviewDocument(imageOcclusion, {}, 'front');
    const stubIndex = doc.indexOf('window.anki=');
    const bodyIndex = doc.indexOf('<body>');
    expect(stubIndex).toBeGreaterThan(-1);
    expect(stubIndex).toBeLessThan(bodyIndex);
  });
});

import { buildFieldMap, renderTemplate } from './renderTemplate';
import { NoteType } from './types';

const basicNoteType: NoteType = {
  id: 1,
  name: 'Basic',
  type: 0,
  css: '',
  fields: [
    { name: 'Front', ord: 0 },
    { name: 'Back', ord: 1 },
    { name: 'Extra', ord: 2 },
  ],
  templates: [],
};

describe('renderTemplate', () => {
  it('substitutes a simple field reference', () => {
    const map = buildFieldMap(['hello', 'world', ''], basicNoteType);
    expect(renderTemplate('<p>{{Front}}</p>', map)).toBe('<p>hello</p>');
  });

  it('uses ord, not array index, to bind field values', () => {
    const reordered: NoteType = {
      ...basicNoteType,
      fields: [
        { name: 'Back', ord: 1 },
        { name: 'Front', ord: 0 },
      ],
    };
    const map = buildFieldMap(['A', 'B'], reordered);
    expect(renderTemplate('{{Front}}/{{Back}}', map)).toBe('A/B');
  });

  it('renders {{#Field}} block only when field is non-empty', () => {
    const map = buildFieldMap(['front', '', ''], basicNoteType);
    const out = renderTemplate('{{Front}}{{#Back}} / {{Back}}{{/Back}}', map);
    expect(out).toBe('front');
  });

  it('treats HTML-only fields as empty for conditionals', () => {
    const map = buildFieldMap(['front', '<br>', ''], basicNoteType);
    const out = renderTemplate('{{Front}}{{#Back}} / {{Back}}{{/Back}}', map);
    expect(out).toBe('front');
  });

  it('renders {{^Field}} block only when field is empty', () => {
    const map = buildFieldMap(['front', '', ''], basicNoteType);
    expect(renderTemplate('{{^Back}}no back{{/Back}}', map)).toBe('no back');
  });

  it('strips HTML with the text: modifier', () => {
    const map = buildFieldMap(['<b>bold</b>', '', ''], basicNoteType);
    expect(renderTemplate('{{text:Front}}', map)).toBe('bold');
  });

  it('substitutes {{FrontSide}} via specials', () => {
    const map = buildFieldMap(['hi', '', ''], basicNoteType);
    const out = renderTemplate('<div>{{FrontSide}}<hr>{{Front}}</div>', map, {
      FrontSide: '<p>hi</p>',
    });
    expect(out).toBe('<div><p>hi</p><hr>hi</div>');
  });

  it('leaves unknown fields as empty string (does not throw)', () => {
    const map = buildFieldMap(['a', '', ''], basicNoteType);
    expect(renderTemplate('{{Nope}}!', map)).toBe('!');
  });

  it('does not recursively template field values containing {{ }}', () => {
    const map = buildFieldMap(['{{Back}}', 'real-back', ''], basicNoteType);
    // Front value contains a literal {{Back}} — must NOT be re-rendered.
    expect(renderTemplate('{{Front}}', map)).toBe('{{Back}}');
  });

  it.each([
    ['an add-on filter stacked on cloze', '{{edit:cloze:Front}}'],
    ['an add-on filter on a plain field', '{{edit:Front}}'],
    ['an unknown filter', '{{some-addon:Front}}'],
  ])('renders the field through %s', (_label, template) => {
    const map = buildFieldMap(['<b>field text</b>', '', ''], basicNoteType);
    expect(renderTemplate(template, map)).toBe('<b>field text</b>');
  });

  it('applies stacked filters right to left', () => {
    const map = buildFieldMap(['<b>bold</b>', '', ''], basicNoteType);
    expect(renderTemplate('{{hint:text:Front}}', map)).toBe(
      '<span class="hint">bold</span>'
    );
  });

  it('resolves a filter written with an empty segment, like {{clickable::Tags}}', () => {
    const map = buildFieldMap(['', '', ''], basicNoteType);
    expect(renderTemplate('{{clickable::Tags}}', map, { Tags: 'cardio' })).toBe(
      'cardio'
    );
  });

  it('renders a tts reference as nothing, since Anki plays it as audio', () => {
    const map = buildFieldMap(['spoken', '', ''], basicNoteType);
    expect(renderTemplate('[{{tts en_US voices=Apple:Front}}]', map)).toBe(
      '[]'
    );
  });
});

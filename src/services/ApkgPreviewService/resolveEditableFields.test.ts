import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveEditableFields } from './resolveEditableFields';
import { NoteType } from './types';

function noteType(
  fieldNames: string[],
  templates: Array<{ qfmt: string; afmt: string }>,
  type: 0 | 1 = 0
): NoteType {
  return {
    id: 1,
    name: 'Test',
    type,
    css: '',
    fields: fieldNames.map((name, ord) => ({ name, ord })),
    templates: templates.map((t, ord) => ({
      name: `Card ${ord + 1}`,
      ord,
      ...t,
    })),
  };
}

interface N2aTemplate {
  fields: Array<{ name: string }>;
  front: string;
  back: string;
}

function n2aNoteType(name: string, type: 0 | 1 = 0): NoteType {
  const file = path.join(__dirname, '../../templates', `${name}.json`);
  const template = JSON.parse(readFileSync(file, 'utf8')) as N2aTemplate;
  return noteType(
    template.fields.map((field) => field.name),
    [{ qfmt: template.front, afmt: template.back }],
    type
  );
}

const BASIC = noteType(
  ['Front', 'Back'],
  [{ qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }]
);

const BASIC_AND_REVERSED = noteType(
  ['Front', 'Back'],
  [
    { qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' },
    { qfmt: '{{Back}}', afmt: '{{FrontSide}}<hr id=answer>{{Front}}' },
  ]
);

const CLOZE = noteType(
  ['Text', 'Back Extra'],
  [{ qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Back Extra}}' }],
  1
);

describe('resolveEditableFields', () => {
  it('maps Basic to Front on the front and Back on the back', () => {
    expect(resolveEditableFields(BASIC, 0)).toEqual({
      front: { fieldIndex: 0, fieldName: 'Front' },
      back: { fieldIndex: 1, fieldName: 'Back' },
    });
  });

  it.each([
    {
      ord: 0,
      front: { fieldIndex: 0, fieldName: 'Front' },
      back: { fieldIndex: 1, fieldName: 'Back' },
    },
    {
      ord: 1,
      front: { fieldIndex: 1, fieldName: 'Back' },
      back: { fieldIndex: 0, fieldName: 'Front' },
    },
  ])(
    'maps the reversed note type card $ord by its own template',
    ({ ord, front, back }) => {
      expect(resolveEditableFields(BASIC_AND_REVERSED, ord)).toEqual({
        front,
        back,
      });
    }
  );

  it.each([0, 1, 4])(
    'edits the Text field of cloze card %i on the front only',
    (ord) => {
      expect(resolveEditableFields(CLOZE, ord)).toEqual({
        front: { fieldIndex: 0, fieldName: 'Text' },
        back: null,
      });
    }
  );

  it('picks the first field each side shows on a three-field note type', () => {
    const vocab = noteType(
      ['Word', 'Pronunciation', 'Meaning'],
      [
        {
          qfmt: '{{Word}}<br>{{Pronunciation}}',
          afmt: '{{FrontSide}}<hr id=answer>{{Meaning}}<br>{{Pronunciation}}',
        },
      ]
    );

    expect(resolveEditableFields(vocab, 0)).toEqual({
      front: { fieldIndex: 0, fieldName: 'Word' },
      back: { fieldIndex: 2, fieldName: 'Meaning' },
    });
  });

  it('prefers a field shown on every card over one inside a conditional', () => {
    const hinted = noteType(
      ['Hint', 'Question', 'Answer'],
      [
        {
          qfmt: '{{#Hint}}{{Hint}}{{/Hint}}{{Question}}',
          afmt: '{{FrontSide}}{{Answer}}',
        },
      ]
    );

    expect(resolveEditableFields(hinted, 0).front).toEqual({
      fieldIndex: 1,
      fieldName: 'Question',
    });
  });

  it('skips text-to-speech references, which show no text', () => {
    const spoken = noteType(
      ['Front', 'Back'],
      [{ qfmt: '{{tts en_US:Front}}{{Back}}', afmt: '{{Front}}' }]
    );

    expect(resolveEditableFields(spoken, 0).front).toEqual({
      fieldIndex: 1,
      fieldName: 'Back',
    });
  });

  it('leaves a back that only repeats the front without an editable field', () => {
    const frontOnly = noteType(
      ['Front', 'Back'],
      [{ qfmt: '{{Front}}', afmt: '{{FrontSide}}' }]
    );

    expect(resolveEditableFields(frontOnly, 0)).toEqual({
      front: { fieldIndex: 0, fieldName: 'Front' },
      back: null,
    });
  });

  it('offers no field for a template without field references', () => {
    const blank = noteType(['Front'], [{ qfmt: 'static', afmt: 'static' }]);

    expect(resolveEditableFields(blank, 0)).toEqual({
      front: null,
      back: null,
    });
  });

  it.each([
    {
      name: 'n2a-basic',
      type: 0 as const,
      front: { fieldIndex: 0, fieldName: 'Front' },
      back: { fieldIndex: 1, fieldName: 'Back' },
    },
    {
      name: 'n2a-cloze',
      type: 1 as const,
      front: { fieldIndex: 0, fieldName: 'Text' },
      back: null,
    },
    {
      name: 'n2a-input',
      type: 0 as const,
      front: { fieldIndex: 0, fieldName: 'Front' },
      back: { fieldIndex: 1, fieldName: 'Back' },
    },
    {
      name: 'n2a-hierarchy',
      type: 0 as const,
      front: { fieldIndex: 3, fieldName: 'Question' },
      back: { fieldIndex: 4, fieldName: 'Answer' },
    },
    {
      name: 'n2a-mcq',
      type: 0 as const,
      front: { fieldIndex: 0, fieldName: 'Question' },
      back: { fieldIndex: 3, fieldName: 'Extra' },
    },
    {
      name: 'n2a-io',
      type: 1 as const,
      front: null,
      back: null,
    },
  ])('maps the $name note type', ({ name, type, front, back }) => {
    expect(resolveEditableFields(n2aNoteType(name, type), 0)).toEqual({
      front,
      back,
    });
  });
});

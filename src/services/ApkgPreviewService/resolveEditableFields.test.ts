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

function templateFile(name: string): string {
  return readFileSync(
    path.join(__dirname, '../../templates', `${name}.html`),
    'utf8'
  );
}

function htmlNoteType(
  fieldNames: string[],
  prefix: string,
  type: 0 | 1 = 0,
  answerFile = `${prefix}_back`
): NoteType {
  return noteType(
    fieldNames,
    [{ qfmt: templateFile(`${prefix}_front`), afmt: templateFile(answerFile) }],
    type
  );
}

const N2A_BASIC_FIELDS = ['Front', 'Back', 'MyMedia'];
const N2A_INPUT_FIELDS = ['Front', 'Back', 'Input', 'MyMedia'];
const STARTER_BASIC_FIELDS = ['Front', 'Back', 'Image', 'Tags'];
const STARTER_CLOZE_FIELDS = ['Text', 'Extra', 'Image', 'Tags'];

const BASIC = noteType(
  ['Front', 'Back'],
  [{ qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }]
);

const ANKI_BASIC = noteType(
  ['Front', 'Back'],
  [{ qfmt: '{{Front}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' }]
);

const ANKI_OPTIONAL_REVERSED = noteType(
  ['Front', 'Back', 'Add Reverse'],
  [
    { qfmt: '{{Front}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' },
    {
      qfmt: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}',
      afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}',
    },
  ]
);

const ANKI_TYPE_IN = noteType(
  ['Front', 'Back'],
  [
    {
      qfmt: '{{Front}}\n\n{{type:Back}}',
      afmt: '{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}',
    },
  ]
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

  it.each<{
    label: string;
    type: NoteType;
    ord: number;
    front: string | null;
    back: string | null;
  }>([
    {
      label: 'Anki Basic',
      type: ANKI_BASIC,
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'Anki Basic (and reversed card), card 1',
      type: BASIC_AND_REVERSED,
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'Anki Basic (and reversed card), card 2',
      type: BASIC_AND_REVERSED,
      ord: 1,
      front: 'Back',
      back: 'Front',
    },
    {
      label: 'Anki Basic (optional reversed card), card 1',
      type: ANKI_OPTIONAL_REVERSED,
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'Anki Basic (optional reversed card), card 2',
      type: ANKI_OPTIONAL_REVERSED,
      ord: 1,
      front: 'Back',
      back: 'Front',
    },
    {
      label: 'Anki Basic (type in the answer)',
      type: ANKI_TYPE_IN,
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    { label: 'Anki Cloze', type: CLOZE, ord: 0, front: 'Text', back: null },
    {
      label: 'n2a-basic',
      type: n2aNoteType('n2a-basic'),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'n2a-cloze',
      type: n2aNoteType('n2a-cloze', 1),
      ord: 0,
      front: 'Text',
      back: null,
    },
    {
      label: 'n2a-input',
      type: n2aNoteType('n2a-input'),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'n2a-hierarchy',
      type: n2aNoteType('n2a-hierarchy'),
      ord: 0,
      front: 'Question',
      back: 'Answer',
    },
    {
      label: 'n2a-mcq',
      type: n2aNoteType('n2a-mcq'),
      ord: 0,
      front: 'Question',
      back: 'Multiple Choice',
    },
    {
      label: 'n2a-io (Image Occlusion)',
      type: n2aNoteType('n2a-io', 1),
      ord: 0,
      front: null,
      back: null,
    },
    {
      label: 'abhiyan basic on a converted deck',
      type: htmlNoteType(N2A_BASIC_FIELDS, 'abhiyan_basic'),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'abhiyan basic starter',
      type: htmlNoteType(STARTER_BASIC_FIELDS, 'abhiyan_basic'),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'abhiyan input',
      type: htmlNoteType(
        N2A_INPUT_FIELDS,
        'abhiyan_input',
        0,
        'abhiyan_basic_back'
      ),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'abhiyan cloze',
      type: htmlNoteType(STARTER_CLOZE_FIELDS, 'abhiyan_cloze', 1),
      ord: 0,
      front: 'Text',
      back: null,
    },
    {
      label: 'alex deluxe basic',
      type: htmlNoteType(N2A_BASIC_FIELDS, 'alex_deluxe_basic'),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'alex deluxe input',
      type: htmlNoteType(N2A_INPUT_FIELDS, 'alex_deluxe_input'),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'alex deluxe cloze',
      type: htmlNoteType(['Text', 'Extra'], 'alex_deluxe_cloze', 1),
      ord: 0,
      front: 'Text',
      back: null,
    },
    {
      label: 'material basic on a converted deck',
      type: htmlNoteType(N2A_BASIC_FIELDS, 'material_basic'),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'material basic starter',
      type: htmlNoteType(STARTER_BASIC_FIELDS, 'material_basic'),
      ord: 0,
      front: 'Front',
      back: 'Back',
    },
    {
      label: 'material cloze',
      type: htmlNoteType(STARTER_CLOZE_FIELDS, 'material_cloze', 1),
      ord: 0,
      front: 'Text',
      back: null,
    },
    {
      label: 'a kept custom note type with three fields',
      type: noteType(
        ['Word', 'Reading', 'Meaning'],
        [
          {
            qfmt: '{{Word}}',
            afmt: '{{FrontSide}}<hr id="answer"><br>{{Reading}}<br>{{Meaning}}',
          },
        ]
      ),
      ord: 0,
      front: 'Word',
      back: 'Reading',
    },
    {
      label: 'a single-field note type',
      type: noteType(['Text'], [{ qfmt: '{{Text}}', afmt: '{{FrontSide}}' }]),
      ord: 0,
      front: 'Text',
      back: null,
    },
  ])('maps $label', ({ type, ord, front, back }) => {
    const side = (name: string | null) =>
      name == null
        ? null
        : {
            fieldIndex: type.fields.findIndex((field) => field.name === name),
            fieldName: name,
          };

    expect(resolveEditableFields(type, ord)).toEqual({
      front: side(front),
      back: side(back),
    });
  });
});

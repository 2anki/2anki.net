import { AnkiNoteType, NoteTypeStarter } from '../../../lib/backend/templates';

export type BaseType = 'basic' | 'cloze';

const BASE_TYPE_FIELDS: Record<
  BaseType,
  Array<{ name: string; ord: number }>
> = {
  basic: [
    { name: 'Front', ord: 0 },
    { name: 'Back', ord: 1 },
  ],
  cloze: [
    { name: 'Text', ord: 0 },
    { name: 'Extra', ord: 1 },
  ],
};

const BASE_TYPE_TEMPLATES: Record<
  BaseType,
  { name: string; qfmt: string; afmt: string }
> = {
  basic: {
    name: 'Card 1',
    qfmt: '<div class="card-front">{{Front}}</div>',
    afmt: '<div class="card-front">{{FrontSide}}</div>\n<hr id="answer">\n<div class="card-back">{{Back}}</div>',
  },
  cloze: {
    name: 'Cloze',
    qfmt: '<div class="card-front">{{cloze:Text}}</div>',
    afmt: '<div class="card-front">{{cloze:Text}}</div>\n<div class="extra">{{Extra}}</div>',
  },
};

const DEFAULT_CSS = `.card {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 20px;
  text-align: center;
  color: #1f2937;
  background: #ffffff;
  padding: 32px;
}

.card-front {
  font-weight: 600;
}

.card-back {
  margin-top: 16px;
  font-weight: 500;
}

#answer {
  border: 0;
  border-top: 1px solid #e5e7eb;
  margin: 16px 0;
}

.cloze {
  font-weight: 600;
  color: #2563eb;
}
`;

const DEFAULT_PREVIEW_DATA: Record<BaseType, Record<string, string>> = {
  basic: {
    Front: 'Capital of France?',
    Back: 'Paris',
  },
  cloze: {
    Text: 'Capital of {{c1::France}} is {{c2::Paris}}',
    Extra: 'European geography',
  },
};

function randomId(): string {
  if (typeof crypto === 'undefined' || !('randomUUID' in crypto)) {
    throw new Error('crypto.randomUUID is not available in this environment');
  }
  return `user-${crypto.randomUUID()}`;
}

export function buildEmptyNoteType(baseType: BaseType): NoteTypeStarter {
  const template = BASE_TYPE_TEMPLATES[baseType];
  const noteType: AnkiNoteType = {
    id: Date.now(),
    name: baseType === 'cloze' ? 'My Cloze' : 'My Basic',
    type: baseType === 'cloze' ? 1 : 0,
    tmpls: [
      {
        name: template.name,
        ord: 0,
        qfmt: template.qfmt,
        afmt: template.afmt,
      },
    ],
    flds: BASE_TYPE_FIELDS[baseType],
    css: DEFAULT_CSS,
  };

  return {
    id: randomId(),
    name: noteType.name,
    description: '',
    baseType,
    noteType,
    previewData: DEFAULT_PREVIEW_DATA[baseType],
    tags: [],
  };
}

export function duplicateStarter(
  starter: NoteTypeStarter,
  sourceName: string = starter.name
): NoteTypeStarter {
  const renamed = starter.name.trim() !== sourceName.trim();
  return {
    ...starter,
    id: randomId(),
    name: renamed ? starter.name : `${starter.name} (copy)`,
    noteType: {
      ...starter.noteType,
      tmpls: starter.noteType.tmpls.map((t) => ({ ...t })),
      flds: starter.noteType.flds.map((f) => ({ ...f })),
    },
    previewData: { ...starter.previewData },
    tags: [...starter.tags],
  };
}

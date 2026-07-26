import {
  McpConvertOptions,
  McpNoteType,
  McpStyleTemplate,
  McpTtsSide,
} from './mcpOptionsToCardSettings';

export interface AppliedTts {
  enabled: boolean;
  language?: string;
  side?: McpTtsSide;
}

export interface AppliedSubdeck {
  deck: string;
  cards: number;
}

export interface AppliedOptions {
  noteType: McpNoteType;
  tags: string[];
  deckName?: string;
  splitByHeadings: boolean;
  styleTemplate?: McpStyleTemplate;
  tts: AppliedTts;
  subdecks?: AppliedSubdeck[];
}

export interface IgnoredOption {
  option: string;
  requested: unknown;
  reason: string;
}

export interface AppliedOptionsResult {
  applied: AppliedOptions;
  ignored?: IgnoredOption[];
}

const NOTE_TYPES: readonly McpNoteType[] = [
  'basic',
  'basic-reversed',
  'cloze',
  'input',
  'mcq',
];

const STYLE_TEMPLATES: readonly McpStyleTemplate[] = [
  'specialstyle',
  'nostyle',
  'abhiyan',
  'alex_deluxe',
];

const TTS_SIDES: readonly McpTtsSide[] = ['front', 'back', 'both'];

const CLOZE_MARKUP = /\{\{c\d+::/;

export function hasClozeMarkup(text: string): boolean {
  return CLOZE_MARKUP.test(text);
}

function resolveTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function resolveTts(tts: McpConvertOptions['tts']): AppliedTts {
  if (tts == null || tts.enabled !== true) {
    return { enabled: false };
  }
  const result: AppliedTts = { enabled: true };
  const language = typeof tts.language === 'string' ? tts.language.trim() : '';
  if (language.length > 0) {
    result.language = language;
  }
  if (tts.side != null && TTS_SIDES.includes(tts.side)) {
    result.side = tts.side;
  }
  return result;
}

export function buildAppliedOptions(
  options: McpConvertOptions | undefined,
  clozeMarkupPresent: boolean,
  inputAnswerTypable: boolean = true
): AppliedOptionsResult {
  const ignored: IgnoredOption[] = [];

  let noteType: McpNoteType = 'basic';
  if (options?.noteType != null && NOTE_TYPES.includes(options.noteType)) {
    noteType = options.noteType;
  }

  if (noteType === 'cloze' && !clozeMarkupPresent) {
    noteType = 'basic';
    ignored.push({
      option: 'noteType',
      requested: 'cloze',
      reason:
        'No {{c1::}} markup found in the text; built basic cards instead.',
    });
  }

  if (noteType === 'input' && !inputAnswerTypable) {
    ignored.push({
      option: 'noteType',
      requested: 'input',
      reason:
        'One or more card backs were too long, multi-line, or contained a link/image to type as an answer; those cards built as basic instead.',
    });
  }

  const applied: AppliedOptions = {
    noteType,
    tags: resolveTags(options?.tags),
    splitByHeadings:
      options?.splitByHeadings === true ||
      options?.splitSectionsIntoDecks === true,
    tts: resolveTts(options?.tts),
  };

  const deckName =
    typeof options?.deckName === 'string' ? options.deckName.trim() : '';
  if (deckName.length > 0) {
    applied.deckName = deckName;
  }

  if (
    options?.styleTemplate != null &&
    STYLE_TEMPLATES.includes(options.styleTemplate)
  ) {
    applied.styleTemplate = options.styleTemplate;
  }

  if (ignored.length > 0) {
    return { applied, ignored };
  }
  return { applied };
}

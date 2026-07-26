export type McpNoteType =
  | 'basic'
  | 'basic-reversed'
  | 'cloze'
  | 'input'
  | 'mcq';

export type McpStyleTemplate =
  | 'specialstyle'
  | 'nostyle'
  | 'abhiyan'
  | 'alex_deluxe';

export type McpTtsSide = 'front' | 'back' | 'both';

export interface McpTtsOption {
  enabled: boolean;
  language?: string;
  side?: McpTtsSide;
}

export interface McpConvertOptions {
  noteType?: McpNoteType;
  tags?: string[];
  deckName?: string;
  splitByHeadings?: boolean;
  splitSectionsIntoDecks?: boolean;
  styleTemplate?: McpStyleTemplate;
  tts?: McpTtsOption;
}

export type McpCreateDeckNoteType = Exclude<McpNoteType, 'mcq'>;

export interface McpCreateDeckOptions {
  noteType?: McpCreateDeckNoteType;
  tags?: string[];
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

function applyNoteType(
  settings: Record<string, string>,
  noteType: McpNoteType
): void {
  if (noteType === 'cloze') {
    settings.cloze = 'true';
    return;
  }
  settings.cloze = 'false';
  if (noteType === 'basic-reversed') {
    settings['basic-reversed'] = 'true';
  } else if (noteType === 'input') {
    settings['enable-input'] = 'true';
  } else if (noteType === 'mcq') {
    settings['mcq-enabled'] = 'true';
  }
}

function applyTts(settings: Record<string, string>, tts: McpTtsOption): void {
  if (tts.enabled !== true) {
    return;
  }
  const language = typeof tts.language === 'string' ? tts.language.trim() : '';
  if (language.length > 0) {
    settings['tts-manual-lang'] = language;
  } else {
    settings['tts-auto-detect'] = 'true';
  }
  if (tts.side != null && TTS_SIDES.includes(tts.side)) {
    settings['tts-manual-side'] = tts.side;
  }
}

export function mcpOptionsToCardSettings(
  options: McpConvertOptions | undefined
): Record<string, string> {
  const settings: Record<string, string> = {};
  if (options == null) {
    return settings;
  }

  if (options.noteType != null && NOTE_TYPES.includes(options.noteType)) {
    applyNoteType(settings, options.noteType);
  }

  if (Array.isArray(options.tags)) {
    const tags = options.tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    if (tags.length > 0) {
      settings['global-tags'] = tags.join(',');
    }
  }

  if (typeof options.deckName === 'string' && options.deckName.trim() !== '') {
    settings.deckName = options.deckName;
  }

  if (
    options.splitByHeadings === true ||
    options.splitSectionsIntoDecks === true
  ) {
    settings['split-sections-into-decks'] = 'true';
  }

  if (
    options.styleTemplate != null &&
    STYLE_TEMPLATES.includes(options.styleTemplate)
  ) {
    settings.template = options.styleTemplate;
  }

  if (options.tts != null) {
    applyTts(settings, options.tts);
  }

  return settings;
}

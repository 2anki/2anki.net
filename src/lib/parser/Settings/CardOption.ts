import { getDefaultUserInstructions } from '../../../infrastracture/adapters/fileConversion/convertPDFToHTML';
import { validateCardStylePicker } from '../../claude/getCardStylePromptFragment';
import { parseTemplate } from './helpers/parseTemplate';
import { validateCardSize } from '../../claude/cardSize';
import type { FieldMapping } from '../../claude/ClaudeService';

import { UserSuppliedTemplateFile } from './types';
import { CARD_OPTION_DEFAULTS } from './cardOptionDefaults';

class CardOption {
  readonly deckName: string | undefined;

  readonly useInput: boolean;

  readonly maxOne: boolean;

  readonly noUnderline: boolean;

  readonly isCherry: boolean;

  readonly isAvocado: boolean;

  readonly isAll: boolean;

  readonly fontSize: string;

  readonly textColor: string;

  readonly textAlign: string;

  readonly isTextOnlyBack: boolean;

  readonly toggleMode: string;

  readonly overlappingCloze: string;

  readonly isCloze: boolean;

  readonly clozeFromToggleContent: boolean;

  readonly groupClozePerToggle: boolean;

  readonly useTags: boolean;

  readonly useSectionTags: boolean;

  readonly globalTags: string[];

  readonly basicReversed: boolean;

  readonly reversed: boolean;

  readonly removeMP3Links: boolean;

  readonly clozeModelName: string;

  readonly basicModelName: string;

  readonly inputModelName: string;

  readonly clozeModelId: string;

  readonly basicModelId: string;

  readonly inputModelId: string;

  readonly template: string;

  readonly perserveNewLines: boolean;

  public n2aCloze: UserSuppliedTemplateFile;

  public n2aBasic: UserSuppliedTemplateFile;

  public n2aInput: UserSuppliedTemplateFile;

  readonly useNotionId: boolean;

  readonly blockIdIdentity: boolean;

  readonly pageEmoji: string;

  parentBlockId: string;

  readonly addNotionLink: boolean;

  readonly nestedBulletPoints: boolean;

  readonly splitSectionsIntoDecks: boolean;

  readonly vertexAIPDFQuestions: boolean;
  readonly disableIndentedBulletPoints: boolean;

  readonly imageQuizHtmlToAnki: boolean;

  readonly embedImages: boolean;

  readonly processPDFs: boolean;

  readonly pdfExtractText: boolean;

  readonly pdfPagePairs: boolean;

  readonly downloadPdfs: boolean;

  readonly claudeAIFlashcards: boolean;

  readonly aiComprehensive: boolean;

  readonly shareFilesForDebugging: boolean;

  readonly userInstructions?: string;

  readonly cardStyle: string;

  readonly codeTheme: string;

  readonly mcqEnabled: boolean;

  readonly mcqTtsQuestion: string;

  readonly mcqTtsCorrectAnswer: string;

  readonly mcqTtsExtra: string;

  readonly ttsAutoDetect: boolean;

  readonly ttsManualLang: string;

  readonly ttsManualSide: 'front' | 'back' | 'both';

  frontLang: string;

  readonly cardSize: 'short' | 'medium' | 'detailed';

  readonly fieldMapping: FieldMapping | undefined;

  constructor(input: { [key: string]: string }) {
    this.deckName = input.deckName;
    if (this.deckName && !this.deckName.trim()) {
      this.deckName = undefined;
    }
    this.useInput = input['enable-input'] === 'true';
    this.maxOne = input['max-one-toggle-per-card'] === 'true';
    this.noUnderline = input['no-underline'] === 'true';
    this.isCherry = input.cherry === 'true';
    this.isAvocado = input.avocado === 'true';
    this.isAll = input.all === 'true';
    this.fontSize = input['font-size'];
    this.textColor = input['text-color'] ?? '';
    this.textAlign = input['text-align'] ?? '';
    this.isTextOnlyBack = input.paragraph === 'true';
    this.toggleMode = input['toggle-mode'] || 'close_toggle';
    this.overlappingCloze = validateOverlappingCloze(
      input['overlapping-cloze']
    );
    this.isCloze = input.cloze !== 'false';
    this.clozeFromToggleContent = input['cloze-from-toggle-content'] === 'true';
    this.groupClozePerToggle = input['group-cloze-per-toggle'] === 'true';
    this.useTags = input.tags !== 'false';
    this.useSectionTags = input['section-tags'] === 'true';
    this.globalTags = parseGlobalTags(input['global-tags']);
    this.basicReversed = input['basic-reversed'] === 'true';
    this.reversed = input.reversed === 'true';
    this.removeMP3Links = input['remove-mp3-links'] === 'true' || false;
    this.perserveNewLines = input['perserve-newlines'] === 'true' || false;
    this.clozeModelName = input.cloze_model_name || 'n2a-cloze';
    this.basicModelName = input.basic_model_name || 'n2a-basic';
    this.inputModelName = input.input_model_name || 'n2a-input';
    this.clozeModelId = input.cloze_model_id;
    this.basicModelId = input.basic_model_id;
    this.inputModelId = input.input_model_id;
    this.template = input.template;
    this.useNotionId = input['use-notion-id'] === 'true';
    this.blockIdIdentity = input['block-id-identity'] === 'true';
    this.parentBlockId = input.parentBlockId;
    this.pageEmoji = input['page-emoji'] || 'first_emoji';
    this.addNotionLink = input['add-notion-link'] === 'true';
    this.vertexAIPDFQuestions = input['vertex-ai-pdf-questions'] === 'true';
    this.disableIndentedBulletPoints =
      input['disable-indented-bullets'] === 'true';
    this.imageQuizHtmlToAnki = input['image-quiz-html-to-anki'] === 'true';
    this.embedImages = input['embed-images'] !== 'false';
    this.processPDFs = input['process-pdfs'] !== 'false';
    this.pdfExtractText = input['pdf-extract-text'] === 'true';
    this.pdfPagePairs = input['pdf-page-pairs'] === 'true';
    this.downloadPdfs = input['download-pdfs'] === 'true';
    this.claudeAIFlashcards = input['claude-ai-flashcards'] === 'true';
    this.aiComprehensive = input['ai-comprehensive'] === 'true';
    this.shareFilesForDebugging = input['share-files-for-debugging'] === 'true';
    /* Is this really needed? */
    if (this.parentBlockId) {
      this.addNotionLink = true;
    }

    this.nestedBulletPoints = input['markdown-nested-bullet-points'] === 'true';
    this.splitSectionsIntoDecks = input['split-sections-into-decks'] === 'true';
    this.userInstructions =
      input['user-instructions'] ?? getDefaultUserInstructions();
    this.cardStyle = validateCardStylePicker(input['card-style']);
    this.codeTheme = validateCodeTheme(input['code-theme']);
    this.mcqEnabled = input['mcq-enabled'] === 'true';
    this.mcqTtsQuestion = input['mcq-tts-question'] ?? '';
    this.mcqTtsCorrectAnswer = input['mcq-tts-correct-answer'] ?? '';
    this.mcqTtsExtra = input['mcq-tts-extra'] ?? '';
    this.ttsAutoDetect = input['tts-auto-detect'] === 'true';
    this.ttsManualLang = input['tts-manual-lang'] ?? '';
    this.ttsManualSide = validateTtsSide(input['tts-manual-side']);
    this.frontLang = '';
    this.cardSize = validateCardSize(input['card-size']);
    this.fieldMapping = parseFieldMapping(input['field-mapping']);
    this.retrieveTemplates(input);
  }

  retrieveTemplates(input: { [key: string]: string }) {
    try {
      this.n2aBasic = parseTemplate(input['n2a-basic']);
      this.n2aCloze = parseTemplate(input['n2a-cloze']);
      this.n2aInput = parseTemplate(input['n2a-input']);
    } catch (error) {
      console.info('Retrieve templates failed');
      console.error(error);
    }
  }

  static LoadDefaultOptions(): { [key: string]: string } {
    return CARD_OPTION_DEFAULTS;
  }
}

const OVERLAPPING_CLOZE_VALUES = ['off', 'show-all', 'windowed'];

function validateOverlappingCloze(raw: string | undefined): string {
  return raw && OVERLAPPING_CLOZE_VALUES.includes(raw) ? raw : 'off';
}

function validateTtsSide(raw: string | undefined): 'front' | 'back' | 'both' {
  return raw === 'back' || raw === 'both' ? raw : 'front';
}

function parseGlobalTags(raw: string | undefined): string[] {
  if (raw == null) {
    return [];
  }
  return raw
    .split(',')
    .map((tag) => tag.trim().replace(/\s+/g, '-'))
    .filter((tag) => tag.length > 0);
}

const CODE_THEME_VALUES = ['github', 'one-dark', 'solarized', 'dracula'];

function validateCodeTheme(raw: string | undefined): string {
  return raw && CODE_THEME_VALUES.includes(raw) ? raw : 'github';
}

function parseFieldMapping(raw: string | undefined): FieldMapping | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as { templateName?: unknown }).templateName !== 'string' ||
      !Array.isArray((parsed as { fields?: unknown }).fields)
    ) {
      return undefined;
    }
    const candidate = parsed as { templateName: string; fields: unknown[] };
    const fields = candidate.fields.filter(
      (f): f is FieldMapping['fields'][number] =>
        f != null &&
        typeof f === 'object' &&
        typeof (f as { name?: unknown }).name === 'string' &&
        typeof (f as { instruction?: unknown }).instruction === 'string'
    );
    if (fields.length === 0) return undefined;
    return { templateName: candidate.templateName, fields };
  } catch {
    return undefined;
  }
}

export default CardOption;

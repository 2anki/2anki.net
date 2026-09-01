import React, {
  forwardRef,
  SyntheticEvent,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { isPayingUser } from '../NavigationBar/helpers/getPlanLabel';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { resetStoredCardOptions } from '../../lib/data_layer/resetStoredCardOptions';
import { getLocalStorageBooleanValue } from '../../lib/data_layer/getLocalStorageBooleanValue';
import { getLocalStorageValue } from '../../lib/data_layer/getLocalStorageValue';
import CardOption from '../../lib/data_layer/model/CardOption';
import { saveValueInLocalStorage } from '../../lib/data_layer/saveValueInLocalStorage';
import { track } from '../../lib/analytics/track';
import { SettingsPayload } from '../../lib/types';
import sharedStyles from '../../styles/shared.module.css';
import { ErrorHandlerType } from '../errors/helpers/getErrorMessage';
import { FieldHint } from '../FieldHint';
import FontSizePicker from '../FontSizePicker';
import TextColorPicker from '../TextColorPicker';
import TextAlignPicker from '../TextAlignPicker';
import LocalCheckbox from '../LocalCheckbox';
import { availableTemplates } from '../modals/SettingsModal/constants';
import { useSettingsCardsOptions } from '../modals/SettingsModal/useSettingsCardsOptions';
import TemplateName from '../TemplateName';
import TemplateSelect from '../TemplateSelect';
import fieldStyles from './CardOptionsForm.module.css';
import { NoteTypePicker } from './NoteTypePicker';
import { useAvailableNoteTypes } from './useAvailableNoteTypes';
import { FieldMappingPanel } from './FieldMappingPanel';
import { getDefaultFieldMapping } from './fieldMappingDefaults';
import { OverlappingClozePreview } from './OverlappingClozePreview';
import type { FieldMapping } from '../../lib/cardFields/types';

interface Props {
  pageTitle?: string | null;
  pageId: string | null;
  isLoggedIn?: boolean;
  onSaved?: (event?: SyntheticEvent) => void;
  onReset?: () => void;
  setError: ErrorHandlerType;
  hideActions?: boolean;
}

export interface CardOptionsFormHandle {
  save: () => Promise<boolean>;
  reset: () => Promise<void>;
  isDirty: () => boolean;
}

const DEFAULT_TEMPLATE = 'specialstyle';
const DEFAULT_TOGGLE_MODE = 'close_toggle';
const DEFAULT_PAGE_EMOJI = 'first_emoji';
const DEFAULT_MCQ_ENABLED = false;
const DEFAULT_MCQ_TTS_LANG = '';
const DEFAULT_TTS_MANUAL_LANG = '';
const DEFAULT_TTS_MANUAL_SIDE = 'front';
const TTS_MANUAL_SIDE_OPTIONS = [
  { labelKey: 'cardOptions.audio.sideFront', value: 'front' },
  { labelKey: 'cardOptions.audio.sideBack', value: 'back' },
  { labelKey: 'cardOptions.audio.sideBoth', value: 'both' },
] as const;
const DEFAULT_CARD_SIZE = 'medium';
const DEFAULT_CARD_STYLE = '';
const DEFAULT_OVERLAPPING_CLOZE = 'off';
const DEFAULT_CODE_THEME = 'github';
const CODE_THEME_OPTIONS = [
  { label: 'GitHub', value: 'github' },
  { label: 'One Dark', value: 'one-dark' },
  { label: 'Solarized', value: 'solarized' },
  { label: 'Dracula', value: 'dracula' },
] as const;
const CARD_SIZE_VALUES = ['short', 'medium', 'detailed'] as const;
type CardSizeValue = (typeof CARD_SIZE_VALUES)[number];

function normalizeCardSize(raw: string | null | undefined): CardSizeValue {
  if (raw === 'short' || raw === 'medium' || raw === 'detailed') return raw;
  return DEFAULT_CARD_SIZE;
}

const CARD_STYLE_VALUES = ['', 'cloze', 'qa', 'heading-driven'] as const;
type CardStyleValue = (typeof CARD_STYLE_VALUES)[number];

function normalizeCardStyle(raw: string | null | undefined): CardStyleValue {
  if (raw === 'cloze' || raw === 'qa' || raw === 'heading-driven') return raw;
  return DEFAULT_CARD_STYLE;
}

const CARD_STYLE_OPTIONS = [
  { labelKey: 'cardOptions.cardStyle.automatic', value: '' },
  { labelKey: 'cardOptions.cardStyle.cloze', value: 'cloze' },
  { labelKey: 'cardOptions.cardStyle.qa', value: 'qa' },
  { labelKey: 'cardOptions.cardStyle.byHeading', value: 'heading-driven' },
] as const;

const MCQ_TTS_LANGUAGE_OPTIONS = [
  { label: "Don't speak", value: '' },
  { label: 'English (US)', value: 'en_US' },
  { label: 'Spanish (Spain)', value: 'es_ES' },
  { label: 'French (France)', value: 'fr_FR' },
  { label: 'German', value: 'de_DE' },
  { label: 'Japanese', value: 'ja_JP' },
  { label: 'Mandarin (Simplified)', value: 'zh_CN' },
  { label: 'Portuguese (Brazil)', value: 'pt_BR' },
] as const;
const DEFAULT_USER_INSTRUCTIONS = `Some extra rules and explanations:
- Read the document from start to finish and identify any question and answers.
- Use the same language as the document or infer the language based on what is mostly used.
- Use the same text as the document and do not make up any questions or answers.
- Cite the document as source for the text.
- Be complete by finding all of the questions and answer in the document.
- Do not limit the number of number of questions and answer but create all of them!
- Do not make up any questions and use the questions in the document!
- Create a ul for every question pair, not one ul for all of them with li!`;

const INSTRUCTION_PRESETS = [
  {
    id: 'mcq_front',
    labelKey: 'cardOptions.userInstructions.presets.mcqOnFront.label',
    sentence:
      "Write multiple-choice questions. Put the question and all answer options (A, B, C, D) on the front of the card; put only the correct option's letter on the back.",
  },
  {
    id: 'one_card_per_item',
    labelKey: 'cardOptions.userInstructions.presets.oneCardPerItem.label',
    sentence:
      'Make a separate card for each list item instead of grouping a list onto one card.',
  },
] as const;

function hasInstructionLine(text: string, sentence: string): boolean {
  return text.split('\n').some((line) => line.trim() === sentence);
}

function appendInstructionLine(text: string, sentence: string): string {
  return text === '' ? sentence : `${text}\n${sentence}`;
}

function removeInstructionLine(text: string, sentence: string): string {
  const lines = text.split('\n');
  const index = lines.findLastIndex((line) => line.trim() === sentence);
  if (index === -1) {
    return text;
  }
  lines.splice(index, 1);
  if (lines[index] === '' && lines[index - 1] === '') {
    lines.splice(index, 1);
  }
  return lines.join('\n');
}

const OPTION_GROUPS: Array<{ id: string; labelKey: string; keys: string[] }> = [
  {
    id: 'content',
    labelKey: 'cardOptions.groups.content',
    keys: [
      'all',
      'paragraph',
      'max-one-toggle-per-card',
      'perserve-newlines',
      'block-id-identity',
    ],
  },
  {
    id: 'cardTypes',
    labelKey: 'cardOptions.groups.cardTypes',
    keys: ['cloze', 'enable-input', 'basic-reversed', 'reversed'],
  },
  {
    id: 'filtering',
    labelKey: 'cardOptions.groups.filtering',
    keys: [
      'cherry',
      'avocado',
      'tags',
      'section-tags',
      'disable-indented-bullets',
    ],
  },
  {
    id: 'linksFormatting',
    labelKey: 'cardOptions.groups.linksFormatting',
    keys: ['add-notion-link', 'no-underline', 'markdown-nested-bullet-points'],
  },
  {
    id: 'pdfAi',
    labelKey: 'cardOptions.groups.pdfAi',
    keys: [
      'process-pdfs',
      'pdf-extract-text',
      'pdf-page-pairs',
      'download-pdfs',
      'claude-ai-flashcards',
      'ai-comprehensive',
    ],
  },
  {
    id: 'media',
    labelKey: 'cardOptions.groups.media',
    keys: ['embed-images'],
  },
  {
    id: 'imageQuizzes',
    labelKey: 'cardOptions.groups.imageQuizzes',
    keys: ['image-quiz-html-to-anki'],
  },
  {
    id: 'debugging',
    labelKey: 'cardOptions.groups.debugging',
    keys: ['share-files-for-debugging'],
  },
];

const HIDDEN_KEYS = [
  'vertex-ai-pdf-questions',
  'remove-mp3-links',
  'cloze-from-toggle-content',
  'group-cloze-per-toggle',
  'remove-deck-name-numbering',
  'split-sections-into-decks',
];
const GROUPED_KEYS = new Set([
  ...OPTION_GROUPS.flatMap((g) => g.keys),
  ...HIDDEN_KEYS,
]);

const PREMIUM_KEYS = new Set([
  'vertex-ai-pdf-questions',
  'claude-ai-flashcards',
  'image-quiz-html-to-anki',
  'ai-comprehensive',
]);

const PAID_ONLY_KEYS = new Set(['ai-comprehensive']);

function computeSnapshot(values: {
  deckName: string;
  fontSize: string;
  textColor: string;
  textAlign: string;
  template: string;
  toggleMode: string;
  overlappingCloze: string;
  codeTheme: string;
  pageEmoji: string;
  basicName: string;
  clozeName: string;
  inputName: string;
  userInstructions: string;
  checkboxValues: Record<string, boolean>;
  mcqEnabled: boolean;
  mcqTtsQuestion: string;
  mcqTtsCorrectAnswer: string;
  mcqTtsExtra: string;
  ttsAutoDetect: boolean;
  ttsManualLang: string;
  ttsManualSide: string;
  cardSize: CardSizeValue;
  cardStyle: CardStyleValue;
  fieldMapping: FieldMapping | null;
}) {
  const sortedCheckboxes = Object.keys(values.checkboxValues)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => [key, values.checkboxValues[key]]);
  return JSON.stringify({ ...values, checkboxValues: sortedCheckboxes });
}

interface GatedToggleRowProps {
  id: string;
  heading: string;
  label: string;
  helperText: string;
  prerequisiteHelperText: string;
  checked: boolean;
  enabled: boolean;
  onChange: (checked: boolean) => void;
}

function GatedToggleRow({
  id,
  heading,
  label,
  helperText,
  prerequisiteHelperText,
  checked,
  enabled,
  onChange,
}: Readonly<GatedToggleRowProps>) {
  return (
    <div className={fieldStyles.optionGroup} id={id}>
      <h3 className={fieldStyles.groupHeading}>{heading}</h3>
      <div className={fieldStyles.section}>
        <label className={fieldStyles.toggleRow}>
          <span className={fieldStyles.toggleSwitch}>
            <input
              type="checkbox"
              role="switch"
              disabled={!enabled}
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className={fieldStyles.toggleSwitchTrack} aria-hidden />
          </span>
          <span className={fieldStyles.toggleLabel}>{label}</span>
        </label>
        {enabled ? (
          <p className={fieldStyles.sectionHint}>{helperText}</p>
        ) : (
          <p className={fieldStyles.sectionHint}>{prerequisiteHelperText}</p>
        )}
      </div>
    </div>
  );
}

export const CardOptionsForm = forwardRef<CardOptionsFormHandle, Props>(
  function CardOptionsForm(
    {
      pageTitle,
      pageId,
      isLoggedIn = true,
      onSaved,
      onReset,
      setError,
      hideActions = false,
    }: Readonly<Props>,
    ref
  ) {
    const { t } = useTranslation();
    const { isLoading, isError, options, loadingDefaultsError } =
      useSettingsCardsOptions(pageId);
    const { data: userLocals } = useUserLocals();
    const isPaying = isPayingUser(userLocals?.locals);
    const { options: availableNoteTypes, loading: noteTypesLoading } =
      useAvailableNoteTypes();
    const [settings, setSettings] = useState<SettingsPayload>({});
    const [loading, setLoading] = useState(!!pageId);
    const deckNameKey = 'deckName';
    const [deckName, setDeckName] = useState(
      getLocalStorageValue(
        deckNameKey,
        pageTitle ?? localStorage.getItem(deckNameKey) ?? '',
        settings
      )
    );
    const [fontSize, setFontSize] = useState(
      getLocalStorageValue('font-size', '', settings)
    );
    const [textColor, setTextColor] = useState(
      getLocalStorageValue('text-color', '', settings)
    );
    const [textAlign, setTextAlign] = useState(
      getLocalStorageValue('text-align', '', settings)
    );
    const [template, setTemplate] = useState(
      getLocalStorageValue('template', DEFAULT_TEMPLATE, settings)
    );
    const [toggleMode, setToggleMode] = useState(
      getLocalStorageValue('toggle-mode', DEFAULT_TOGGLE_MODE, settings)
    );
    const [overlappingCloze, setOverlappingCloze] = useState(
      getLocalStorageValue(
        'overlapping-cloze',
        DEFAULT_OVERLAPPING_CLOZE,
        settings
      )
    );
    const [codeTheme, setCodeTheme] = useState(
      getLocalStorageValue('code-theme', DEFAULT_CODE_THEME, settings)
    );
    const [pageEmoji, setPageEmoji] = useState(
      getLocalStorageValue('page-emoji', DEFAULT_PAGE_EMOJI, settings)
    );
    const [basicName, setBasicName] = useState(
      getLocalStorageValue('basic_model_name', '', settings)
    );
    const [clozeName, setClozeName] = useState(
      getLocalStorageValue('cloze_model_name', '', settings)
    );
    const [inputName, setInputName] = useState(
      getLocalStorageValue('input_model_name', '', settings)
    );
    const [userInstructions, setUserInstructions] = useState(
      getLocalStorageValue(
        'user-instructions',
        DEFAULT_USER_INSTRUCTIONS,
        settings
      )
    );
    const [instructionsOpen, setInstructionsOpen] = useState(
      window.location.hash === '#pdf-ai'
    );
    const [checkboxValues, setCheckboxValues] = useState<
      Record<string, boolean>
    >({});
    const [mcqEnabled, setMcqEnabled] = useState(
      getLocalStorageBooleanValue(
        'mcq-enabled',
        DEFAULT_MCQ_ENABLED.toString(),
        settings
      )
    );
    const [mcqTtsQuestion, setMcqTtsQuestion] = useState(
      getLocalStorageValue('mcq-tts-question', DEFAULT_MCQ_TTS_LANG, settings)
    );
    const [mcqTtsCorrectAnswer, setMcqTtsCorrectAnswer] = useState(
      getLocalStorageValue(
        'mcq-tts-correct-answer',
        DEFAULT_MCQ_TTS_LANG,
        settings
      )
    );
    const [mcqTtsExtra, setMcqTtsExtra] = useState(
      getLocalStorageValue('mcq-tts-extra', DEFAULT_MCQ_TTS_LANG, settings)
    );
    const [ttsAutoDetect, setTtsAutoDetect] = useState(
      getLocalStorageBooleanValue('tts-auto-detect', 'false', settings)
    );
    const [ttsManualLang, setTtsManualLang] = useState(
      getLocalStorageValue('tts-manual-lang', DEFAULT_TTS_MANUAL_LANG, settings)
    );
    const [ttsManualSide, setTtsManualSide] = useState(
      getLocalStorageValue('tts-manual-side', DEFAULT_TTS_MANUAL_SIDE, settings)
    );
    const [cardSize, setCardSize] = useState<CardSizeValue>(() =>
      normalizeCardSize(
        getLocalStorageValue('card-size', DEFAULT_CARD_SIZE, settings)
      )
    );
    const [cardStyle, setCardStyle] = useState<CardStyleValue>(() =>
      normalizeCardStyle(
        getLocalStorageValue('card-style', DEFAULT_CARD_STYLE, settings)
      )
    );
    const [fieldMapping, setFieldMapping] = useState<FieldMapping | null>(() =>
      getDefaultFieldMapping(
        getLocalStorageValue('template', DEFAULT_TEMPLATE, settings)
      )
    );
    const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const savingRef = useRef(false);

    useEffect(() => {
      if (!options) return;
      const next: Record<string, boolean> = {};
      options.forEach((o: CardOption) => {
        next[o.key] = getLocalStorageBooleanValue(
          o.key,
          o.value.toString(),
          settings
        );
      });
      setCheckboxValues(next);
    }, [options, settings]);

    useEffect(() => {
      if (!pageId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setInitialSnapshot(null);
      setDeckName(pageTitle ?? localStorage.getItem(deckNameKey) ?? '');
      setFontSize(localStorage.getItem('font-size') ?? '');
      setTextColor(localStorage.getItem('text-color') ?? '');
      setTextAlign(localStorage.getItem('text-align') ?? '');
      setTemplate(localStorage.getItem('template') ?? DEFAULT_TEMPLATE);
      setToggleMode(localStorage.getItem('toggle-mode') ?? DEFAULT_TOGGLE_MODE);
      setOverlappingCloze(
        localStorage.getItem('overlapping-cloze') ?? DEFAULT_OVERLAPPING_CLOZE
      );
      setPageEmoji(localStorage.getItem('page-emoji') ?? DEFAULT_PAGE_EMOJI);
      setCodeTheme(localStorage.getItem('code-theme') ?? DEFAULT_CODE_THEME);
      setBasicName(localStorage.getItem('basic_model_name') ?? '');
      setClozeName(localStorage.getItem('cloze_model_name') ?? '');
      setInputName(localStorage.getItem('input_model_name') ?? '');
      setUserInstructions(
        localStorage.getItem('user-instructions') ?? DEFAULT_USER_INSTRUCTIONS
      );
      setMcqEnabled(
        (localStorage.getItem('mcq-enabled') ??
          DEFAULT_MCQ_ENABLED.toString()) === 'true'
      );
      setMcqTtsQuestion(
        localStorage.getItem('mcq-tts-question') ?? DEFAULT_MCQ_TTS_LANG
      );
      setMcqTtsCorrectAnswer(
        localStorage.getItem('mcq-tts-correct-answer') ?? DEFAULT_MCQ_TTS_LANG
      );
      setMcqTtsExtra(
        localStorage.getItem('mcq-tts-extra') ?? DEFAULT_MCQ_TTS_LANG
      );
      setTtsAutoDetect(
        (localStorage.getItem('tts-auto-detect') ?? 'false') === 'true'
      );
      setTtsManualLang(
        localStorage.getItem('tts-manual-lang') ?? DEFAULT_TTS_MANUAL_LANG
      );
      setTtsManualSide(
        localStorage.getItem('tts-manual-side') ?? DEFAULT_TTS_MANUAL_SIDE
      );
      setCardSize(normalizeCardSize(localStorage.getItem('card-size')));
      setCardStyle(normalizeCardStyle(localStorage.getItem('card-style')));
      setFieldMapping(
        getDefaultFieldMapping(
          localStorage.getItem('template') ?? DEFAULT_TEMPLATE
        )
      );
      setSettings({});

      const applyPayload = (payload: SettingsPayload) => {
        const assignments: Array<[string, (value: string) => void]> = [
          ['deckName', setDeckName],
          ['toggle-mode', setToggleMode],
          ['overlapping-cloze', setOverlappingCloze],
          ['code-theme', setCodeTheme],
          ['page-emoji', setPageEmoji],
          ['template', setTemplate],
          ['font-size', setFontSize],
          ['text-color', setTextColor],
          ['text-align', setTextAlign],
          ['basic_model_name', setBasicName],
          ['cloze_model_name', setClozeName],
          ['input_model_name', setInputName],
          ['user-instructions', setUserInstructions],
          ['mcq-tts-question', setMcqTtsQuestion],
          ['mcq-tts-correct-answer', setMcqTtsCorrectAnswer],
          ['mcq-tts-extra', setMcqTtsExtra],
          ['tts-manual-lang', setTtsManualLang],
          ['tts-manual-side', setTtsManualSide],
        ];
        assignments.forEach(([key, setter]) => {
          if (Object.hasOwn(payload, key)) {
            setter(payload[key] ?? '');
          }
        });
        if (Object.hasOwn(payload, 'mcq-enabled')) {
          setMcqEnabled((payload['mcq-enabled'] ?? 'false') === 'true');
        }
        if (Object.hasOwn(payload, 'tts-auto-detect')) {
          setTtsAutoDetect((payload['tts-auto-detect'] ?? 'false') === 'true');
        }
        if (Object.hasOwn(payload, 'card-size')) {
          setCardSize(normalizeCardSize(payload['card-size']));
        }
        if (Object.hasOwn(payload, 'card-style')) {
          setCardStyle(normalizeCardStyle(payload['card-style']));
        }
        if (Object.hasOwn(payload, 'field-mapping')) {
          try {
            const parsed = JSON.parse(
              payload['field-mapping'] ?? 'null'
            ) as unknown;
            setFieldMapping(
              parsed != null && typeof parsed === 'object'
                ? (parsed as FieldMapping)
                : null
            );
          } catch {
            setFieldMapping(null);
          }
        }
        setSettings(payload);
      };

      get2ankiApi()
        .getSettings(pageId)
        .then((payload) => {
          if (payload) applyPayload(payload);
          setLoading(false);
        })
        .catch((error) => {
          setLoading(false);
          setError(error);
        });
    }, [pageId]);

    useEffect(() => {
      if (isError && loadingDefaultsError) {
        setError(loadingDefaultsError);
      }
    }, [isError, loadingDefaultsError, setError]);

    const currentSnapshot = useMemo(
      () =>
        computeSnapshot({
          deckName,
          fontSize,
          textColor,
          textAlign,
          template,
          toggleMode,
          overlappingCloze,
          codeTheme,
          pageEmoji,
          basicName,
          clozeName,
          inputName,
          userInstructions,
          checkboxValues,
          mcqEnabled,
          mcqTtsQuestion,
          mcqTtsCorrectAnswer,
          mcqTtsExtra,
          ttsAutoDetect,
          ttsManualLang,
          ttsManualSide,
          cardSize,
          cardStyle,
          fieldMapping,
        }),
      [
        deckName,
        fontSize,
        textColor,
        textAlign,
        template,
        toggleMode,
        overlappingCloze,
        codeTheme,
        pageEmoji,
        basicName,
        clozeName,
        inputName,
        userInstructions,
        checkboxValues,
        mcqEnabled,
        mcqTtsQuestion,
        mcqTtsCorrectAnswer,
        mcqTtsExtra,
        ttsAutoDetect,
        ttsManualLang,
        ttsManualSide,
        cardSize,
        cardStyle,
        fieldMapping,
      ]
    );

    useEffect(() => {
      if (loading || isLoading) return;
      if (initialSnapshot !== null) return;
      const expectedCheckboxes = options?.length ?? 0;
      if (expectedCheckboxes > 0 && Object.keys(checkboxValues).length === 0)
        return;
      setInitialSnapshot(currentSnapshot);
    }, [
      loading,
      isLoading,
      initialSnapshot,
      options,
      checkboxValues,
      currentSnapshot,
    ]);

    useEffect(() => {
      if (!justSaved) return;
      const timer = setTimeout(() => setJustSaved(false), 2500);
      return () => clearTimeout(timer);
    }, [justSaved]);

    const toggleCheckbox = (key: string, checked: boolean) => {
      setCheckboxValues((prev) => ({ ...prev, [key]: checked }));
      saveValueInLocalStorage(key, checked.toString(), pageId);
    };

    const resetStore = async () => {
      if (pageId) {
        await get2ankiApi().deleteSettings(pageId);
      } else if (isLoggedIn) {
        try {
          await get2ankiApi().resetUserCardOptions();
        } catch {
          setError(new Error(t('cardOptions.resetError')));
          return;
        }
      }
      resetStoredCardOptions(options ?? []);
      setDeckName('');
      setFontSize('');
      setTextColor('');
      setTextAlign('');
      setToggleMode(DEFAULT_TOGGLE_MODE);
      setOverlappingCloze(DEFAULT_OVERLAPPING_CLOZE);
      setCodeTheme(DEFAULT_CODE_THEME);
      setTemplate(DEFAULT_TEMPLATE);
      setPageEmoji(DEFAULT_PAGE_EMOJI);
      setBasicName('');
      setClozeName('');
      setInputName('');
      setUserInstructions(DEFAULT_USER_INSTRUCTIONS);
      setMcqEnabled(DEFAULT_MCQ_ENABLED);
      setMcqTtsQuestion(DEFAULT_MCQ_TTS_LANG);
      setMcqTtsCorrectAnswer(DEFAULT_MCQ_TTS_LANG);
      setMcqTtsExtra(DEFAULT_MCQ_TTS_LANG);
      setTtsAutoDetect(false);
      setTtsManualLang(DEFAULT_TTS_MANUAL_LANG);
      setTtsManualSide(DEFAULT_TTS_MANUAL_SIDE);
      setCardSize(DEFAULT_CARD_SIZE);
      setCardStyle(DEFAULT_CARD_STYLE);
      setFieldMapping(getDefaultFieldMapping(DEFAULT_TEMPLATE));
      if (options) {
        const reset: Record<string, boolean> = {};
        options.forEach((o: CardOption) => {
          reset[o.key] = o.value;
        });
        setCheckboxValues(reset);
      }
      setInitialSnapshot(null);
      onReset?.();
    };

    const serverSave = async (): Promise<boolean> => {
      if (!pageId) return true;
      if (savingRef.current) return false;
      savingRef.current = true;
      const payload: { [key: string]: string } = {};
      Object.entries(checkboxValues).forEach(([key, value]) => {
        payload[key] = value.toString();
      });
      payload.deckName = deckName;
      payload['toggle-mode'] = toggleMode;
      payload['overlapping-cloze'] = overlappingCloze;
      payload['code-theme'] = codeTheme;
      payload.template = template;
      payload.basic_model_name = basicName;
      payload.cloze_model_name = clozeName;
      payload.input_model_name = inputName;
      payload['font-size'] = fontSize;
      payload['text-color'] = textColor;
      payload['text-align'] = textAlign;
      payload['page-emoji'] = pageEmoji;
      payload['user-instructions'] = userInstructions;
      payload['mcq-enabled'] = mcqEnabled.toString();
      payload['mcq-tts-question'] = mcqTtsQuestion;
      payload['mcq-tts-correct-answer'] = mcqTtsCorrectAnswer;
      payload['mcq-tts-extra'] = mcqTtsExtra;
      payload['tts-auto-detect'] = ttsAutoDetect.toString();
      payload['tts-manual-lang'] = ttsManualLang;
      payload['tts-manual-side'] = ttsManualSide;
      payload['card-size'] = cardSize;
      payload['card-style'] = cardStyle;
      if (fieldMapping != null) {
        payload['field-mapping'] = JSON.stringify(fieldMapping);
      }

      setIsSaving(true);
      setSaveFailed(false);
      try {
        await get2ankiApi().saveSettings({
          object_id: pageId,
          title: pageTitle ?? null,
          payload,
        });
        setInitialSnapshot(currentSnapshot);
        if (onSaved == null) setJustSaved(true);
        return true;
      } catch (error) {
        setSaveFailed(true);
        setError(error);
        return false;
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    };

    useImperativeHandle(ref, () => ({
      save: serverSave,
      reset: resetStore,
      isDirty: () =>
        initialSnapshot !== null && currentSnapshot !== initialSnapshot,
    }));

    const onSubmit = async (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!pageId) {
        onSaved?.(event);
        return;
      }
      const ok = await serverSave();
      if (ok) onSaved?.(event);
    };

    const checkboxesReady =
      !options ||
      options.length === 0 ||
      Object.keys(checkboxValues).length > 0;
    if (loading || isLoading || !checkboxesReady) {
      return (
        <div className={fieldStyles.loading}>
          <div className={sharedStyles.spinner} />
        </div>
      );
    }

    const isDirty =
      initialSnapshot !== null && currentSnapshot !== initialSnapshot;

    const optionsByKey = Object.fromEntries(
      (options ?? []).map((o: CardOption) => [o.key, o])
    );

    const generalOptions = (options ?? []).filter(
      (o: CardOption) => !GROUPED_KEYS.has(o.key)
    );

    const toggleInstructionPreset = (
      preset: (typeof INSTRUCTION_PRESETS)[number]
    ) => {
      const wasSelected = hasInstructionLine(userInstructions, preset.sentence);
      const next = wasSelected
        ? removeInstructionLine(userInstructions, preset.sentence)
        : appendInstructionLine(userInstructions, preset.sentence);
      setUserInstructions(next);
      if (!pageId) {
        saveValueInLocalStorage('user-instructions', next, pageId);
      }
      if (!wasSelected) {
        setInstructionsOpen(true);
      }
      track('ai_preset_applied', {
        preset: preset.id,
        action: wasSelected ? 'removed' : 'added',
        scope: pageId ? 'page' : 'default',
      });
    };

    const userInstructionsDisclosure = (
      <div className={fieldStyles.section}>
        <span className={fieldStyles.sectionLabel}>
          {t('cardOptions.userInstructions.presetsLabel')}
        </span>
        <p className={fieldStyles.sectionHint}>
          {t('cardOptions.userInstructions.presetsHint')}
        </p>
        <div
          className={fieldStyles.instructionChips}
          role="group"
          aria-label={t('cardOptions.userInstructions.presetsAria')}
        >
          {INSTRUCTION_PRESETS.map((preset) => {
            const selected = hasInstructionLine(
              userInstructions,
              preset.sentence
            );
            return (
              <button
                key={preset.id}
                type="button"
                className={`${fieldStyles.instructionChip} ${
                  selected ? fieldStyles.instructionChipActive : ''
                }`}
                aria-pressed={selected}
                onClick={() => toggleInstructionPreset(preset)}
              >
                {t(preset.labelKey)}
              </button>
            );
          })}
        </div>
        <details
          open={instructionsOpen}
          onToggle={(e) => setInstructionsOpen(e.currentTarget.open)}
        >
          <summary className={fieldStyles.detailsSummary}>
            {t('cardOptions.userInstructions.summary')}
          </summary>
          <textarea
            className={fieldStyles.instructionsTextarea}
            value={userInstructions}
            onChange={(e) => {
              setUserInstructions(e.target.value);
              saveValueInLocalStorage(
                'user-instructions',
                e.target.value,
                pageId
              );
            }}
            rows={4}
            placeholder={t('cardOptions.userInstructions.placeholder')}
          />
        </details>
      </div>
    );

    const showResetButton = !hideActions && pageId == null;
    const showSaveButton = !hideActions && isDirty;
    const showSavedStatus = !hideActions && justSaved;
    const showSaveError = !hideActions && saveFailed;

    return (
      <div className={fieldStyles.form}>
        {(showResetButton ||
          showSaveButton ||
          showSavedStatus ||
          showSaveError) && (
          <div className={fieldStyles.saveBar}>
            {showSaveError && (
              <span role="alert" className={fieldStyles.saveError}>
                {t('cardOptions.saveBar.saveError')}
              </span>
            )}
            {showSavedStatus && (
              <span
                role="status"
                aria-live="polite"
                className={fieldStyles.savedStatus}
              >
                {t('cardOptions.saveBar.saved')}
              </span>
            )}
            {showResetButton && (
              <button
                type="button"
                className={`${sharedStyles.btnSecondary} ${fieldStyles.actionButton}`}
                onClick={resetStore}
                disabled={isSaving}
              >
                {t('cardOptions.saveBar.reset')}
              </button>
            )}
            {showSaveButton && (
              <button
                type="button"
                className={`${sharedStyles.btnPrimary} ${fieldStyles.actionButton}`}
                onClick={onSubmit}
                disabled={isSaving}
                aria-busy={isSaving}
              >
                {isSaving && (
                  <span className={sharedStyles.spinnerSmall} aria-hidden />
                )}
                {isSaving
                  ? t('cardOptions.saveBar.saving')
                  : t('cardOptions.saveBar.save')}
              </button>
            )}
          </div>
        )}

        <div className={fieldStyles.optionGroup}>
          <h3 className={fieldStyles.groupHeading}>
            {t('cardOptions.deck.structureHeading')}
          </h3>

          <div className={fieldStyles.section}>
            <div className={fieldStyles.labelRow}>
              <label htmlFor="deck-name" className={fieldStyles.sectionLabel}>
                {t('cardOptions.deck.nameLabel')}
              </label>
              <FieldHint text={t('cardOptions.deck.nameHint')} />
            </div>
            <input
              id="deck-name"
              name="deck-name"
              className={fieldStyles.deckInput}
              placeholder={t('cardOptions.deck.namePlaceholder')}
              value={deckName}
              onChange={(e) => {
                const newName = e.target.value;
                if (newName !== deckName) setDeckName(newName);
                saveValueInLocalStorage(deckNameKey, newName, pageId);
              }}
            />
          </div>

          <fieldset
            className={`${fieldStyles.section} ${fieldStyles.fieldsetReset}`}
          >
            <legend className={fieldStyles.legendReset}>
              <span className={fieldStyles.labelRow}>
                <span className={fieldStyles.sectionLabel}>
                  {t('cardOptions.deck.iconLabel')}
                </span>
                <FieldHint text={t('cardOptions.deck.iconHint')} />
              </span>
            </legend>
            <div className={fieldStyles.segmented}>
              {(
                [
                  {
                    label: t('cardOptions.deck.iconFirst'),
                    value: 'first_emoji',
                  },
                  {
                    label: t('cardOptions.deck.iconLast'),
                    value: 'last_emoji',
                  },
                  {
                    label: t('cardOptions.deck.iconDisable'),
                    value: 'disable_emoji',
                  },
                ] as const
              ).map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  className={`${fieldStyles.segment} ${pageEmoji === value ? fieldStyles.segmentActive : ''}`}
                  onClick={() => {
                    setPageEmoji(value);
                    saveValueInLocalStorage('page-emoji', value, pageId);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset
            className={`${fieldStyles.section} ${fieldStyles.fieldsetReset}`}
          >
            <legend className={fieldStyles.legendReset}>
              <span className={fieldStyles.labelRow}>
                <span className={fieldStyles.sectionLabel}>
                  {t('cardOptions.deck.toggleModeLabel')}
                </span>
                <FieldHint text={t('cardOptions.deck.toggleModeHint')} />
              </span>
            </legend>
            <div className={fieldStyles.segmented}>
              {(
                [
                  {
                    label: t('cardOptions.deck.toggleOpen'),
                    value: 'open_toggle',
                  },
                  {
                    label: t('cardOptions.deck.toggleClose'),
                    value: 'close_toggle',
                  },
                ] as const
              ).map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  className={`${fieldStyles.segment} ${toggleMode === value ? fieldStyles.segmentActive : ''}`}
                  onClick={() => {
                    setToggleMode(value);
                    saveValueInLocalStorage('toggle-mode', value, pageId);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className={fieldStyles.groupOptions}>
            <LocalCheckbox
              label={t('cardOptions.deck.removeNumberingLabel')}
              description={t('cardOptions.deck.removeNumberingHelp')}
              defaultValue={
                checkboxValues['remove-deck-name-numbering'] ?? false
              }
              onChecked={(checked) =>
                toggleCheckbox('remove-deck-name-numbering', checked)
              }
            />
          </div>
        </div>

        {generalOptions.length > 0 && (
          <div className={fieldStyles.optionGroup}>
            <h3 className={fieldStyles.groupHeading}>
              {t('cardOptions.general')}
            </h3>
            <div className={fieldStyles.groupOptions}>
              {generalOptions.map((o: CardOption) => (
                <LocalCheckbox
                  key={o.key}
                  defaultValue={checkboxValues[o.key] ?? false}
                  label={o.label}
                  description={o.description}
                  onChecked={(checked) => toggleCheckbox(o.key, checked)}
                  badge={PREMIUM_KEYS.has(o.key) ? 'Premium' : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {OPTION_GROUPS.map((group) => {
          const groupOptions = group.keys
            .map((k) => optionsByKey[k])
            .filter(Boolean)
            .filter((o: CardOption) => isPaying || !PAID_ONLY_KEYS.has(o.key));
          if (groupOptions.length === 0) return null;

          const isPdfAiGroup = group.id === 'pdfAi';
          const isCardTypesGroup = group.id === 'cardTypes';
          const isLinksFormattingGroup = group.id === 'linksFormatting';
          const isFilteringGroup = group.id === 'filtering';
          const sectionTagsOption = optionsByKey['section-tags'];
          const inlineOptions = groupOptions.filter(
            (o: CardOption) => o.key !== 'section-tags'
          );

          return (
            <React.Fragment key={group.id}>
              <div
                className={fieldStyles.optionGroup}
                id={isPdfAiGroup ? 'pdf-ai' : undefined}
              >
                <h3 className={fieldStyles.groupHeading}>
                  {t(group.labelKey)}
                </h3>
                <div className={fieldStyles.groupOptions}>
                  {inlineOptions.map((o: CardOption) => (
                    <LocalCheckbox
                      key={o.key}
                      defaultValue={checkboxValues[o.key] ?? false}
                      label={o.label}
                      description={o.description}
                      onChecked={(checked) => toggleCheckbox(o.key, checked)}
                      badge={PREMIUM_KEYS.has(o.key) ? 'Premium' : undefined}
                    />
                  ))}
                  {isPdfAiGroup &&
                    (checkboxValues['ai-comprehensive'] ?? false) && (
                      <p className={fieldStyles.sectionHint}>
                        {t('cardOptions.comprehensiveHint')}{' '}
                        <a href="#card-size">
                          {t('cardOptions.comprehensiveHintLink')}
                        </a>
                      </p>
                    )}
                  {isPdfAiGroup && (
                    <div className={fieldStyles.section} id="card-style">
                      <label
                        htmlFor="card-style-select"
                        className={fieldStyles.sectionLabel}
                      >
                        {t('cardOptions.cardStyle.heading')}
                      </label>
                      <select
                        id="card-style-select"
                        className={fieldStyles.deckInput}
                        value={cardStyle}
                        onChange={(e) => {
                          const value = normalizeCardStyle(e.target.value);
                          setCardStyle(value);
                          saveValueInLocalStorage('card-style', value, pageId);
                          track('card_style_selected', { style: value });
                        }}
                      >
                        {CARD_STYLE_OPTIONS.map(({ labelKey, value }) => (
                          <option key={value || 'automatic'} value={value}>
                            {t(labelKey)}
                          </option>
                        ))}
                      </select>
                      <p className={fieldStyles.sectionHint}>
                        {t('cardOptions.cardStyle.hint')}
                      </p>
                    </div>
                  )}
                  {isPdfAiGroup && userInstructionsDisclosure}
                </div>
              </div>
              {isFilteringGroup && sectionTagsOption && (
                <GatedToggleRow
                  id="section-tags"
                  heading={sectionTagsOption.label}
                  label={sectionTagsOption.label}
                  helperText={sectionTagsOption.description}
                  prerequisiteHelperText={t('cardOptions.prereq.cherry')}
                  checked={checkboxValues['section-tags'] ?? false}
                  enabled={checkboxValues['cherry'] ?? false}
                  onChange={(checked) =>
                    toggleCheckbox('section-tags', checked)
                  }
                />
              )}
              {isLinksFormattingGroup && (
                <div className={fieldStyles.optionGroup} id="code-blocks">
                  <h3 className={fieldStyles.groupHeading}>
                    {t('cardOptions.codeBlocks.heading')}
                  </h3>
                  <p className={fieldStyles.groupIntro}>
                    {t('cardOptions.codeBlocks.intro')}
                  </p>
                  <div className={fieldStyles.section}>
                    <div className={fieldStyles.labelRow}>
                      <label
                        htmlFor="code-theme"
                        className={fieldStyles.sectionLabel}
                      >
                        {t('cardOptions.codeBlocks.themeLabel')}
                      </label>
                      <FieldHint text={t('cardOptions.codeBlocks.themeHint')} />
                    </div>
                    <select
                      id="code-theme"
                      className={fieldStyles.deckInput}
                      value={codeTheme}
                      onChange={(e) => {
                        setCodeTheme(e.target.value);
                        saveValueInLocalStorage(
                          'code-theme',
                          e.target.value,
                          pageId
                        );
                      }}
                    >
                      {CODE_THEME_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {isCardTypesGroup && (
                <div className={fieldStyles.optionGroup} id="card-size">
                  <div className={fieldStyles.groupHeader}>
                    <h3 className={fieldStyles.groupHeading}>
                      {t('cardOptions.cardSize.heading')}
                    </h3>
                    <div
                      className={fieldStyles.segmented}
                      role="group"
                      aria-label={t('cardOptions.cardSize.heading')}
                    >
                      {(
                        [
                          {
                            label: t('cardOptions.cardSize.short'),
                            value: 'short',
                          },
                          {
                            label: t('cardOptions.cardSize.medium'),
                            value: 'medium',
                          },
                          {
                            label: t('cardOptions.cardSize.detailed'),
                            value: 'detailed',
                          },
                        ] as const
                      ).map(({ label, value }) => (
                        <button
                          key={value}
                          type="button"
                          className={`${fieldStyles.segment} ${cardSize === value ? fieldStyles.segmentActive : ''}`}
                          aria-pressed={cardSize === value}
                          onClick={() => {
                            setCardSize(value);
                            saveValueInLocalStorage('card-size', value, pageId);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className={fieldStyles.groupIntro}>
                    {t('cardOptions.cardSize.intro')}
                  </p>
                  <ul className={fieldStyles.bulletList}>
                    <li>
                      <strong>{t('cardOptions.cardSize.short')}</strong> —{' '}
                      {t('cardOptions.cardSize.shortDesc')}
                    </li>
                    <li>
                      <strong>{t('cardOptions.cardSize.medium')}</strong> —{' '}
                      {t('cardOptions.cardSize.mediumDesc')}
                    </li>
                    <li>
                      <strong>{t('cardOptions.cardSize.detailed')}</strong> —{' '}
                      {t('cardOptions.cardSize.detailedDesc')}
                    </li>
                  </ul>
                </div>
              )}
              {isCardTypesGroup && (
                <div className={fieldStyles.optionGroup} id="mcq">
                  <div className={fieldStyles.groupHeader}>
                    <h3 className={fieldStyles.groupHeading}>
                      {t('cardOptions.mcq.heading')}
                    </h3>
                    <div
                      className={fieldStyles.segmented}
                      role="group"
                      aria-label={t('cardOptions.mcq.aria')}
                    >
                      {(
                        [
                          { label: t('cardOptions.mcq.off'), value: false },
                          { label: t('cardOptions.mcq.on'), value: true },
                        ] as const
                      ).map(({ label, value }) => (
                        <button
                          key={label}
                          type="button"
                          className={`${fieldStyles.segment} ${mcqEnabled === value ? fieldStyles.segmentActive : ''}`}
                          onClick={() => {
                            setMcqEnabled(value);
                            saveValueInLocalStorage(
                              'mcq-enabled',
                              value.toString(),
                              pageId
                            );
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className={fieldStyles.groupIntro}>
                    {t('cardOptions.mcq.introPrefix')}
                    <Link
                      to="/documentation/cards/mcq"
                      className={fieldStyles.groupIntroLink}
                    >
                      {t('cardOptions.mcq.introDocs')}
                    </Link>
                    {t('cardOptions.mcq.introSuffix')}
                  </p>

                  {mcqEnabled && (
                    <>
                      <div className={fieldStyles.section}>
                        <p className={fieldStyles.sectionLabel}>
                          {t('cardOptions.mcq.readAloud')}
                        </p>
                        <p className={fieldStyles.sectionHint}>
                          {t('cardOptions.mcq.readAloudHint')}
                        </p>

                        {(
                          [
                            {
                              label: t('cardOptions.mcq.question'),
                              key: 'mcq-tts-question',
                              value: mcqTtsQuestion,
                              setter: setMcqTtsQuestion,
                            },
                            {
                              label: t('cardOptions.mcq.correctAnswer'),
                              key: 'mcq-tts-correct-answer',
                              value: mcqTtsCorrectAnswer,
                              setter: setMcqTtsCorrectAnswer,
                            },
                            {
                              label: t('cardOptions.mcq.extra'),
                              key: 'mcq-tts-extra',
                              value: mcqTtsExtra,
                              setter: setMcqTtsExtra,
                            },
                          ] as const
                        ).map(({ label, key, value, setter }) => (
                          <div key={key} className={fieldStyles.section}>
                            <div className={fieldStyles.labelRow}>
                              <label
                                htmlFor={key}
                                className={fieldStyles.sectionLabel}
                              >
                                {label}
                              </label>
                            </div>
                            <select
                              id={key}
                              className={fieldStyles.deckInput}
                              value={value}
                              onChange={(e) => {
                                setter(e.target.value);
                                saveValueInLocalStorage(
                                  key,
                                  e.target.value,
                                  pageId
                                );
                              }}
                            >
                              {MCQ_TTS_LANGUAGE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.value === ''
                                    ? t('cardOptions.tts.dontSpeak')
                                    : opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}

                        <p className={fieldStyles.sectionHint}>
                          {t('cardOptions.mcq.noVoiceHint')}
                        </p>
                        <p className={fieldStyles.sectionHint}>
                          {t('cardOptions.mcq.missingLangPrefix')}
                          <a href="mailto:support@2anki.net">
                            support@2anki.net
                          </a>
                          {t('cardOptions.mcq.missingLangSuffix')}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
              {isCardTypesGroup && (
                <div className={fieldStyles.optionGroup} id="overlapping-cloze">
                  <div className={fieldStyles.groupHeader}>
                    <h3 className={fieldStyles.groupHeading}>
                      {t('cardOptions.overlappingCloze.heading')}
                    </h3>
                    <div
                      className={fieldStyles.segmented}
                      role="group"
                      aria-label={t('cardOptions.overlappingCloze.heading')}
                    >
                      {(
                        [
                          {
                            label: t('cardOptions.overlappingCloze.off'),
                            value: 'off',
                          },
                          {
                            label: t('cardOptions.overlappingCloze.showAll'),
                            value: 'show-all',
                          },
                          {
                            label: t('cardOptions.overlappingCloze.windowed'),
                            value: 'windowed',
                          },
                        ] as const
                      ).map(({ label, value }) => (
                        <button
                          key={value}
                          type="button"
                          disabled={!(checkboxValues['cloze'] ?? true)}
                          className={`${fieldStyles.segment} ${overlappingCloze === value ? fieldStyles.segmentActive : ''}`}
                          aria-pressed={overlappingCloze === value}
                          onClick={() => {
                            setOverlappingCloze(value);
                            saveValueInLocalStorage(
                              'overlapping-cloze',
                              value,
                              pageId
                            );
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className={fieldStyles.groupIntro}>
                    {t('cardOptions.overlappingCloze.intro')}
                  </p>
                  {(checkboxValues['cloze'] ?? true) ? (
                    <>
                      <ul className={fieldStyles.bulletList}>
                        <li>
                          <strong>
                            {t('cardOptions.overlappingCloze.showAll')}
                          </strong>{' '}
                          — {t('cardOptions.overlappingCloze.showAllDesc')}
                        </li>
                        <li>
                          <strong>
                            {t('cardOptions.overlappingCloze.windowed')}
                          </strong>{' '}
                          — {t('cardOptions.overlappingCloze.windowedDesc')}
                        </li>
                      </ul>
                      {overlappingCloze !== 'off' && (
                        <OverlappingClozePreview
                          style={overlappingCloze as 'show-all' | 'windowed'}
                        />
                      )}
                    </>
                  ) : (
                    <p className={fieldStyles.sectionHint}>
                      {t('cardOptions.prereq.cloze')}
                    </p>
                  )}
                </div>
              )}
              {isCardTypesGroup && (
                <GatedToggleRow
                  id="group-cloze-per-toggle"
                  heading={t('cardOptions.gated.groupClozeHeading')}
                  label={t('cardOptions.gated.groupClozeHeading')}
                  helperText={t('cardOptions.gated.groupClozeHelp')}
                  prerequisiteHelperText={t('cardOptions.prereq.cloze')}
                  checked={checkboxValues['group-cloze-per-toggle'] ?? false}
                  enabled={checkboxValues['cloze'] ?? true}
                  onChange={(checked) =>
                    toggleCheckbox('group-cloze-per-toggle', checked)
                  }
                />
              )}
              {isCardTypesGroup && (
                <GatedToggleRow
                  id="cloze-from-toggle-content"
                  heading={t('cardOptions.gated.inlineCodeHeading')}
                  label={t('cardOptions.gated.inlineCodeHeading')}
                  helperText={t('cardOptions.gated.inlineCodeHelp')}
                  prerequisiteHelperText={t('cardOptions.prereq.cloze')}
                  checked={checkboxValues['cloze-from-toggle-content'] ?? false}
                  enabled={checkboxValues['cloze'] ?? true}
                  onChange={(checked) =>
                    toggleCheckbox('cloze-from-toggle-content', checked)
                  }
                />
              )}
              {isCardTypesGroup && (
                <div className={fieldStyles.optionGroup} id="audio">
                  <h3 className={fieldStyles.groupHeading}>
                    {t('cardOptions.audio.heading')}
                  </h3>
                  <p className={fieldStyles.groupIntro}>
                    {t('cardOptions.audio.intro')}
                  </p>

                  <div className={fieldStyles.section}>
                    <label className={fieldStyles.toggleRow}>
                      <span className={fieldStyles.toggleSwitch}>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={ttsAutoDetect}
                          onChange={(e) => {
                            setTtsAutoDetect(e.target.checked);
                            saveValueInLocalStorage(
                              'tts-auto-detect',
                              e.target.checked.toString(),
                              pageId
                            );
                          }}
                        />
                        <span
                          className={fieldStyles.toggleSwitchTrack}
                          aria-hidden
                        />
                      </span>
                      <span className={fieldStyles.toggleLabel}>
                        {t('cardOptions.audio.readAloud')}
                      </span>
                    </label>
                    <p className={fieldStyles.sectionHint}>
                      {t('cardOptions.audio.readAloudHint')}
                    </p>
                  </div>

                  <div className={fieldStyles.section}>
                    <p className={fieldStyles.sectionLabel}>
                      {t('cardOptions.audio.pickVoice')}
                    </p>
                    <p className={fieldStyles.sectionHint}>
                      {t('cardOptions.audio.pickVoiceHint')}
                    </p>
                    <div className={fieldStyles.section}>
                      <div className={fieldStyles.labelRow}>
                        <label
                          htmlFor="tts-manual-lang"
                          className={fieldStyles.sectionLabel}
                        >
                          {t('cardOptions.audio.language')}
                        </label>
                      </div>
                      <select
                        id="tts-manual-lang"
                        className={fieldStyles.deckInput}
                        value={ttsManualLang}
                        onChange={(e) => {
                          setTtsManualLang(e.target.value);
                          saveValueInLocalStorage(
                            'tts-manual-lang',
                            e.target.value,
                            pageId
                          );
                        }}
                      >
                        {MCQ_TTS_LANGUAGE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {ttsManualLang && (
                      <div className={fieldStyles.section}>
                        <p className={fieldStyles.sectionLabel}>
                          {t('cardOptions.audio.read')}
                        </p>
                        <div
                          className={fieldStyles.segmented}
                          role="group"
                          aria-label={t('cardOptions.audio.readAria')}
                        >
                          {TTS_MANUAL_SIDE_OPTIONS.map(
                            ({ labelKey, value }) => (
                              <button
                                key={value}
                                type="button"
                                className={`${fieldStyles.segment} ${ttsManualSide === value ? fieldStyles.segmentActive : ''}`}
                                aria-pressed={ttsManualSide === value}
                                onClick={() => {
                                  setTtsManualSide(value);
                                  saveValueInLocalStorage(
                                    'tts-manual-side',
                                    value,
                                    pageId
                                  );
                                }}
                              >
                                {t(labelKey)}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    )}
                    <p className={fieldStyles.sectionHint}>
                      {t('cardOptions.audio.noVoiceHint')}
                    </p>
                  </div>

                  {optionsByKey['remove-mp3-links'] && (
                    <div className={fieldStyles.section}>
                      <label className={fieldStyles.toggleRow}>
                        <span className={fieldStyles.toggleSwitch}>
                          <input
                            type="checkbox"
                            role="switch"
                            checked={
                              checkboxValues['remove-mp3-links'] ?? false
                            }
                            onChange={(e) =>
                              toggleCheckbox(
                                'remove-mp3-links',
                                e.target.checked
                              )
                            }
                          />
                          <span
                            className={fieldStyles.toggleSwitchTrack}
                            aria-hidden
                          />
                        </span>
                        <span className={fieldStyles.toggleLabel}>
                          {t('cardOptions.audio.removeMp3')}
                        </span>
                      </label>
                      <p className={fieldStyles.sectionHint}>
                        {t('cardOptions.audio.removeMp3Hint')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}

        <div className={fieldStyles.optionGroup}>
          <h3 className={fieldStyles.groupHeading}>
            {t('cardOptions.templates.heading')}
          </h3>
          <p className={fieldStyles.groupIntro}>
            {t('cardOptions.templates.introPrefix')}
            <Link to="/templates" className={fieldStyles.groupIntroLink}>
              {t('cardOptions.templates.introLink')}
            </Link>
            {t('cardOptions.templates.introMiddle')}
            <strong>{t('cardOptions.templates.introStrong')}</strong>
            {t('cardOptions.templates.introSuffix')}
          </p>
          <div className={fieldStyles.section}>
            <TemplateSelect
              values={availableTemplates}
              value={template}
              name="template"
              label={t('cardOptions.templates.cardStyleLabel')}
              hint={t('cardOptions.templates.cardStyleHint')}
              pickedTemplate={(t) => {
                setTemplate(t);
                saveValueInLocalStorage('template', t, pageId);
                const defaultMapping = getDefaultFieldMapping(t);
                setFieldMapping(defaultMapping);
              }}
            />
          </div>
          {fieldMapping != null && (
            <FieldMappingPanel
              mapping={fieldMapping}
              onChange={(updated) => setFieldMapping(updated)}
            />
          )}
          {template === 'custom' ? (
            <>
              <div className={fieldStyles.section}>
                <NoteTypePicker
                  name="basic_model_name"
                  label={t('cardOptions.templates.basicNoteType')}
                  placeholder={t('cardOptions.templates.basicPlaceholder')}
                  hint={t('cardOptions.templates.basicNoteHint')}
                  value={basicName}
                  options={availableNoteTypes.basic}
                  loading={noteTypesLoading}
                  onChange={(name) => {
                    setBasicName(name);
                    saveValueInLocalStorage('basic_model_name', name, pageId);
                  }}
                />
              </div>
              <div className={fieldStyles.section}>
                <NoteTypePicker
                  name="cloze_model_name"
                  label={t('cardOptions.templates.clozeNoteType')}
                  placeholder={t('cardOptions.templates.clozePlaceholder')}
                  hint={t('cardOptions.templates.clozeNoteHint')}
                  value={clozeName}
                  options={availableNoteTypes.cloze}
                  loading={noteTypesLoading}
                  onChange={(name) => {
                    setClozeName(name);
                    saveValueInLocalStorage('cloze_model_name', name, pageId);
                  }}
                />
              </div>
              <div className={fieldStyles.section}>
                <NoteTypePicker
                  name="input_model_name"
                  label={t('cardOptions.templates.inputNoteType')}
                  placeholder={t('cardOptions.templates.inputPlaceholder')}
                  hint={t('cardOptions.templates.inputNoteHint')}
                  value={inputName}
                  options={availableNoteTypes.input}
                  loading={noteTypesLoading}
                  onChange={(name) => {
                    setInputName(name);
                    saveValueInLocalStorage('input_model_name', name, pageId);
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div className={fieldStyles.section}>
                <TemplateName
                  name="basic_model_name"
                  value={basicName}
                  placeholder={t('cardOptions.templates.basicPlaceholder')}
                  label={t('cardOptions.templates.basicTemplateName')}
                  hint={t('cardOptions.templates.basicTemplateHint')}
                  pickedName={(name) => {
                    setBasicName(name);
                    saveValueInLocalStorage('basic_model_name', name, pageId);
                  }}
                />
              </div>
              <div className={fieldStyles.section}>
                <TemplateName
                  name="cloze_model_name"
                  value={clozeName}
                  placeholder={t('cardOptions.templates.clozePlaceholder')}
                  label={t('cardOptions.templates.clozeTemplateName')}
                  hint={t('cardOptions.templates.clozeTemplateHint')}
                  pickedName={(name) => {
                    setClozeName(name);
                    saveValueInLocalStorage('cloze_model_name', name, pageId);
                  }}
                />
              </div>
              <div className={fieldStyles.section}>
                <TemplateName
                  name="input_model_name"
                  value={inputName}
                  placeholder={t('cardOptions.templates.inputPlaceholder')}
                  label={t('cardOptions.templates.inputTemplateName')}
                  hint={t('cardOptions.templates.inputTemplateHint')}
                  pickedName={(name) => {
                    setInputName(name);
                    saveValueInLocalStorage('input_model_name', name, pageId);
                  }}
                />
              </div>
            </>
          )}
          <div className={fieldStyles.section}>
            <FontSizePicker
              fontSize={fontSize}
              pickedFontSize={(fs) => {
                setFontSize(fs);
                saveValueInLocalStorage('font-size', fs.toString(), pageId);
              }}
            />
          </div>
          <div className={fieldStyles.section}>
            <TextColorPicker
              textColor={textColor}
              pickedTextColor={(color) => {
                setTextColor(color);
                saveValueInLocalStorage('text-color', color, pageId);
              }}
            />
          </div>
          <div className={fieldStyles.section}>
            <TextAlignPicker
              textAlign={textAlign}
              pickedTextAlign={(align) => {
                setTextAlign(align);
                saveValueInLocalStorage('text-align', align, pageId);
              }}
            />
          </div>
        </div>
      </div>
    );
  }
);

import type { Knex } from 'knex';

export type CardOptions = Partial<{
  deckName: string;
  'font-size': string;
  'text-color': string;
  'text-align': string;
  template: string;
  'toggle-mode': string;
  'page-emoji': string;
  basic_model_name: string;
  cloze_model_name: string;
  input_model_name: string;
  'user-instructions': string;
  'skip-defaults': string;
  'overlapping-cloze': string;
  'code-theme': string;
  'card-size': string;
  'field-mapping': string;
  'mcq-enabled': string;
  'mcq-tts-question': string;
  'mcq-tts-correct-answer': string;
  'mcq-tts-extra': string;
  'tts-auto-detect': string;
  'tts-manual-lang': string;
  'tts-manual-side': string;
  'add-notion-link': string;
  'use-notion-id': string;
  all: string;
  paragraph: string;
  cherry: string;
  avocado: string;
  tags: string;
  'section-tags': string;
  cloze: string;
  'cloze-from-toggle-content': string;
  'group-cloze-per-toggle': string;
  'enable-input': string;
  'basic-reversed': string;
  reversed: string;
  'no-underline': string;
  'max-one-toggle-per-card': string;
  'remove-mp3-links': string;
  'perserve-newlines': string;
  'process-pdfs': string;
  'pdf-extract-text': string;
  'pdf-page-pairs': string;
  'download-pdfs': string;
  'markdown-nested-bullet-points': string;
  'split-sections-into-decks': string;
  'vertex-ai-pdf-questions': string;
  'disable-indented-bullets': string;
  'image-quiz-html-to-anki': string;
  'embed-images': string;
  'claude-ai-flashcards': string;
  'ai-comprehensive': string;
  'share-files-for-debugging': string;
  'block-id-identity': string;
}>;

export interface UserPreferences {
  cardOptions: CardOptions | null;
  theme: string | null;
  language: string | null;
  ankiWebAcknowledgedAt: string | null;
}

export interface IUserPreferencesRepository {
  get(userId: number): Promise<UserPreferences>;
  patch(
    userId: number,
    prefs: Partial<UserPreferences>
  ): Promise<UserPreferences>;
  migrate(
    userId: number,
    prefs: Partial<UserPreferences>
  ): Promise<UserPreferences>;
  clearCardOptions(userId: number): Promise<UserPreferences>;
  setBlockIdIdentity(
    userId: number,
    enabled: boolean
  ): Promise<UserPreferences>;
}

const BLOCK_ID_IDENTITY_KEY = 'block-id-identity';

export const ALLOWED_CARD_OPTION_KEYS = new Set([
  'deckName',
  'font-size',
  'text-color',
  'text-align',
  'template',
  'toggle-mode',
  'page-emoji',
  'basic_model_name',
  'cloze_model_name',
  'input_model_name',
  'user-instructions',
  'skip-defaults',
  'overlapping-cloze',
  'code-theme',
  'card-size',
  'field-mapping',
  'mcq-enabled',
  'mcq-tts-question',
  'mcq-tts-correct-answer',
  'mcq-tts-extra',
  'tts-auto-detect',
  'tts-manual-lang',
  'tts-manual-side',
  'add-notion-link',
  'use-notion-id',
  'all',
  'paragraph',
  'cherry',
  'avocado',
  'tags',
  'section-tags',
  'cloze',
  'cloze-from-toggle-content',
  'group-cloze-per-toggle',
  'enable-input',
  'basic-reversed',
  'reversed',
  'no-underline',
  'max-one-toggle-per-card',
  'remove-mp3-links',
  'perserve-newlines',
  'process-pdfs',
  'pdf-extract-text',
  'pdf-page-pairs',
  'download-pdfs',
  'markdown-nested-bullet-points',
  'split-sections-into-decks',
  'vertex-ai-pdf-questions',
  'disable-indented-bullets',
  'image-quiz-html-to-anki',
  'embed-images',
  'claude-ai-flashcards',
  'ai-comprehensive',
  'share-files-for-debugging',
]);

export function sanitizeCardOptions(raw: CardOptions): CardOptions {
  const result: CardOptions = {};
  for (const key of ALLOWED_CARD_OPTION_KEYS) {
    const typedKey = key as keyof CardOptions;
    const value = raw[typedKey];
    if (typeof value === 'string') {
      result[typedKey] = value;
    }
  }
  return result;
}

export class UserPreferencesRepository implements IUserPreferencesRepository {
  constructor(private readonly database: Knex) {}

  async get(userId: number): Promise<UserPreferences> {
    const row = await this.database('users')
      .select('card_options', 'theme', 'language', 'anki_web_acknowledged_at')
      .where({ id: userId })
      .first();
    return {
      cardOptions: row?.card_options ?? null,
      theme: row?.theme ?? null,
      language: row?.language ?? null,
      ankiWebAcknowledgedAt:
        row?.anki_web_acknowledged_at?.toISOString() ?? null,
    };
  }

  async patch(
    userId: number,
    prefs: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const update: Record<string, unknown> = {};
    if (prefs.cardOptions != null) {
      update.card_options = this.mergedCardOptions(
        sanitizeCardOptions(prefs.cardOptions)
      );
    }
    if (prefs.theme != null) {
      update.theme = prefs.theme;
    }
    if (prefs.language != null) {
      update.language = prefs.language;
    }
    if (prefs.ankiWebAcknowledgedAt != null) {
      update.anki_web_acknowledged_at = this.database.raw(
        'GREATEST(anki_web_acknowledged_at, ?::timestamptz)',
        [prefs.ankiWebAcknowledgedAt]
      );
    }
    if (Object.keys(update).length > 0) {
      await this.database('users').where({ id: userId }).update(update);
    }
    return this.get(userId);
  }

  private mergedCardOptions(options: Record<string, string | undefined>) {
    return this.database.raw(
      "coalesce(card_options, '{}'::jsonb) || ?::jsonb",
      [JSON.stringify(options)]
    );
  }

  buildMergeCardOptionsQuery(
    userId: number,
    options: Record<string, string | undefined>
  ) {
    return this.database('users')
      .where({ id: userId })
      .update({ card_options: this.mergedCardOptions(options) });
  }

  buildRemoveCardOptionQuery(userId: number, key: string) {
    return this.database('users')
      .where({ id: userId })
      .update({
        card_options: this.database.raw('card_options - ?::text', [key]),
      });
  }

  async setBlockIdIdentity(
    userId: number,
    enabled: boolean
  ): Promise<UserPreferences> {
    if (enabled) {
      await this.buildMergeCardOptionsQuery(userId, {
        [BLOCK_ID_IDENTITY_KEY]: 'true',
      });
    } else {
      await this.buildRemoveCardOptionQuery(userId, BLOCK_ID_IDENTITY_KEY);
    }
    return this.get(userId);
  }

  async migrate(
    userId: number,
    prefs: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const current = await this.get(userId);
    const update: Record<string, unknown> = {};
    if (prefs.cardOptions != null && current.cardOptions == null) {
      update.card_options = sanitizeCardOptions(prefs.cardOptions);
    }
    if (prefs.theme != null && current.theme == null) {
      update.theme = prefs.theme;
    }
    if (prefs.language != null && current.language == null) {
      update.language = prefs.language;
    }
    if (
      prefs.ankiWebAcknowledgedAt != null &&
      current.ankiWebAcknowledgedAt == null
    ) {
      update.anki_web_acknowledged_at = prefs.ankiWebAcknowledgedAt;
    }
    if (Object.keys(update).length > 0) {
      await this.database('users').where({ id: userId }).update(update);
    }
    return this.get(userId);
  }

  async clearCardOptions(userId: number): Promise<UserPreferences> {
    await this.database('users')
      .where({ id: userId })
      .update({ card_options: null });
    return this.get(userId);
  }
}

function laterOf(a: string | null, b: string): string {
  if (a == null) return b;
  return a >= b ? a : b;
}

export class InMemoryUserPreferencesRepository implements IUserPreferencesRepository {
  private readonly store = new Map<number, UserPreferences>();

  async get(userId: number): Promise<UserPreferences> {
    return (
      this.store.get(userId) ?? {
        cardOptions: null,
        theme: null,
        language: null,
        ankiWebAcknowledgedAt: null,
      }
    );
  }

  async patch(
    userId: number,
    prefs: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const current = await this.get(userId);
    const next: UserPreferences = {
      cardOptions:
        prefs.cardOptions == null
          ? current.cardOptions
          : { ...current.cardOptions, ...prefs.cardOptions },
      theme: prefs.theme ?? current.theme,
      language: prefs.language ?? current.language,
      ankiWebAcknowledgedAt:
        prefs.ankiWebAcknowledgedAt == null
          ? current.ankiWebAcknowledgedAt
          : laterOf(current.ankiWebAcknowledgedAt, prefs.ankiWebAcknowledgedAt),
    };
    this.store.set(userId, next);
    return next;
  }

  async migrate(
    userId: number,
    prefs: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const current = await this.get(userId);
    const next: UserPreferences = {
      cardOptions: current.cardOptions ?? prefs.cardOptions ?? null,
      theme: current.theme ?? prefs.theme ?? null,
      language: current.language ?? prefs.language ?? null,
      ankiWebAcknowledgedAt:
        current.ankiWebAcknowledgedAt ?? prefs.ankiWebAcknowledgedAt ?? null,
    };
    this.store.set(userId, next);
    return next;
  }

  async clearCardOptions(userId: number): Promise<UserPreferences> {
    const current = await this.get(userId);
    const next: UserPreferences = { ...current, cardOptions: null };
    this.store.set(userId, next);
    return next;
  }

  async setBlockIdIdentity(
    userId: number,
    enabled: boolean
  ): Promise<UserPreferences> {
    const current = await this.get(userId);
    const next: UserPreferences = {
      ...current,
      cardOptions: enabled
        ? { ...current.cardOptions, [BLOCK_ID_IDENTITY_KEY]: 'true' }
        : withoutBlockIdIdentity(current.cardOptions),
    };
    this.store.set(userId, next);
    return next;
  }

  clear(): void {
    this.store.clear();
  }
}

function withoutBlockIdIdentity(
  cardOptions: CardOptions | null
): CardOptions | null {
  if (cardOptions == null) return null;
  const rest: CardOptions = { ...cardOptions };
  delete rest[BLOCK_ID_IDENTITY_KEY];
  return rest;
}

export default UserPreferencesRepository;

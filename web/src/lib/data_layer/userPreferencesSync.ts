import i18n, { LANGUAGE_STORAGE_KEY } from '../i18n';

export const CARD_OPTION_KEYS = [
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
  'card-style',
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
] as const;

const PREFERENCES_URL = '/api/users/me/preferences';
const MIGRATE_URL = '/api/users/me/preferences/migrate';
export const ANKI_WEB_ACK_KEY = 'ankify_anki_web_acknowledged';

function isAuthed(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith('token='));
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelPendingSync(): void {
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function collectCardOptions(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of CARD_OPTION_KEYS) {
    const value = localStorage.getItem(key);
    if (value != null) {
      result[key] = value;
    }
  }
  return result;
}

export function scheduleSync(): void {
  cancelPendingSync();
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    if (!isAuthed()) return;
    const cardOptions = collectCardOptions();
    const theme = localStorage.getItem('2anki-theme');
    const language = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const body: Record<string, unknown> = {};
    if (Object.keys(cardOptions).length > 0) {
      body.cardOptions = cardOptions;
    }
    if (theme != null) {
      body.theme = theme;
    }
    if (language != null) {
      body.language = language;
    }
    if (Object.keys(body).length === 0) return;
    try {
      await fetch(PREFERENCES_URL, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // silent — next save will retry
    }
  }, 500);
}

export async function acknowledgeAnkiWeb(): Promise<void> {
  try {
    localStorage.setItem(ANKI_WEB_ACK_KEY, 'true');
  } catch {}
  if (!isAuthed()) return;
  try {
    await fetch(PREFERENCES_URL, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ankiWebAcknowledgedAt: new Date().toISOString() }),
    });
  } catch {
    // silent — localStorage is already set, server will sync on next login
  }
}

export interface ServerUserPreferences {
  cardOptions: Record<string, string> | null;
  theme: string | null;
  language: string | null;
  ankiWebAcknowledgedAt: string | null;
}

export async function fetchUserPreferences(): Promise<ServerUserPreferences | null> {
  if (!isAuthed()) return null;
  try {
    const res = await fetch(PREFERENCES_URL, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as ServerUserPreferences;
  } catch {
    return null;
  }
}

export async function hydrateFromServer(): Promise<void> {
  if (!isAuthed()) return;
  try {
    const res = await fetch(PREFERENCES_URL, { credentials: 'include' });
    if (!res.ok) return;
    const { cardOptions, theme, language, ankiWebAcknowledgedAt } =
      await res.json();
    if (cardOptions != null && typeof cardOptions === 'object') {
      for (const [key, value] of Object.entries(cardOptions)) {
        if (typeof value === 'string') {
          localStorage.setItem(key, value);
        }
      }
    }
    if (typeof theme === 'string') {
      localStorage.setItem('2anki-theme', theme);
    }
    if (typeof language === 'string') {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      i18n.changeLanguage(language);
    }
    if (typeof ankiWebAcknowledgedAt === 'string') {
      try {
        localStorage.setItem(ANKI_WEB_ACK_KEY, 'true');
      } catch {}
    }
  } catch {
    // silent
  }
}

export async function migrateToServer(): Promise<void> {
  if (!isAuthed()) return;
  const cardOptions = collectCardOptions();
  const theme = localStorage.getItem('2anki-theme');
  const language = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  const body: Record<string, unknown> = {};
  if (Object.keys(cardOptions).length > 0) {
    body.cardOptions = cardOptions;
  }
  if (theme != null) {
    body.theme = theme;
  }
  if (language != null) {
    body.language = language;
  }
  try {
    if (localStorage.getItem(ANKI_WEB_ACK_KEY) === 'true') {
      body.ankiWebAcknowledgedAt = new Date().toISOString();
    }
  } catch {}
  if (Object.keys(body).length === 0) return;
  try {
    await fetch(MIGRATE_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // silent
  }
}

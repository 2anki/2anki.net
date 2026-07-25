export const ANKI_CONNECT_VERSION = 6;
export const ANKI_CONNECT_DEFAULT_TIMEOUT_MS = 10_000;
// `sync` triggers a blocking AnkiWeb round-trip inside the container; it
// routinely needs far longer than a cheap action like `version` or `addNote`.
export const ANKI_CONNECT_SYNC_TIMEOUT_MS = 60_000;

export interface AnkiConnectNoteFields {
  [key: string]: string;
}

export interface AnkiConnectNote {
  deckName: string;
  modelName: string;
  fields: AnkiConnectNoteFields;
  tags?: string[];
  options?: {
    allowDuplicate?: boolean;
    duplicateScope?: 'deck' | 'collection';
  };
}

export interface AnkiConnectResponse<T> {
  result: T;
  error: string | null;
}

export class AnkiConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnkiConnectError';
  }
}

// AnkiConnect's `sync` action surfaced Anki's own sync protocol saying a
// one-way full sync is required (ChangesRequired != NO_CHANGES/NORMAL_SYNC).
// Anki can't safely auto-pick a direction (risk of overwriting one side), so
// this can only be resolved by a human via the Anki desktop app.
export class AnkiFullSyncRequiredError extends AnkiConnectError {
  constructor(cause: string) {
    super(cause);
    this.name = 'AnkiFullSyncRequiredError';
  }
}

export class AnkiConnectUnreachableError extends Error {
  constructor(url: string, cause: unknown) {
    super(`AnkiConnect unreachable at ${url}`);
    this.name = 'AnkiConnectUnreachableError';
    if (cause instanceof Error) {
      this.stack = cause.stack;
    }
  }
}

// A call that exceeded its own deadline, not a dead container. Extends
// AnkiConnectUnreachableError so existing `instanceof` checks keep treating it
// as offline, while the name + message say what actually happened (a slow call,
// usually `sync`, after a pre-flight `ping` already proved the container was up).
export class AnkiConnectTimeoutError extends AnkiConnectUnreachableError {
  constructor(
    readonly url: string,
    readonly action: string,
    readonly timeoutMs: number,
    cause: unknown
  ) {
    super(url, cause);
    this.name = 'AnkiConnectTimeoutError';
    this.message = `AnkiConnect call '${action}' timed out after ${timeoutMs}ms at ${url}`;
  }
}

type FetchLike = typeof fetch;

export class AnkiConnectClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs: number = ANKI_CONNECT_DEFAULT_TIMEOUT_MS,
    private readonly apiKey: string | null = null
  ) {}

  async createDeck(deck: string): Promise<number> {
    return this.invoke('createDeck', { deck });
  }

  async addNote(note: AnkiConnectNote): Promise<number> {
    return this.invoke('addNote', { note });
  }

  async addNotes(notes: AnkiConnectNote[]): Promise<Array<number | null>> {
    return this.invoke('addNotes', { notes });
  }

  async updateNoteFields(
    noteId: number,
    fields: AnkiConnectNoteFields
  ): Promise<null> {
    return this.invoke('updateNoteFields', { note: { id: noteId, fields } });
  }

  async findNotes(query: string): Promise<number[]> {
    return this.invoke('findNotes', { query });
  }

  async notesInfo(notes: number[]): Promise<AnkiNoteInfo[]> {
    return this.invoke('notesInfo', { notes });
  }

  async changeDeck(cards: number[], deck: string): Promise<null> {
    return this.invoke('changeDeck', { cards, deck });
  }

  async deckNames(): Promise<string[]> {
    return this.invoke('deckNames');
  }

  async deckNamesAndIds(): Promise<Record<string, number>> {
    return this.invoke('deckNamesAndIds', {});
  }

  async modelNames(): Promise<string[]> {
    return this.invoke('modelNames');
  }

  async modelFieldNames(modelName: string): Promise<string[]> {
    return this.invoke('modelFieldNames', { modelName });
  }

  async getMediaFilesNames(pattern: string): Promise<string[]> {
    return this.invoke('getMediaFilesNames', { pattern });
  }

  async createModel(params: AnkiConnectCreateModelParams): Promise<unknown> {
    return this.invoke(
      'createModel',
      params as unknown as Record<string, unknown>
    );
  }

  async updateModelStyling(
    params: AnkiConnectUpdateStylingParams
  ): Promise<null> {
    return this.invoke('updateModelStyling', { model: params });
  }

  async updateModelTemplates(
    params: AnkiConnectUpdateTemplatesParams
  ): Promise<null> {
    return this.invoke('updateModelTemplates', { model: params });
  }

  async storeMediaFile(
    params: AnkiConnectStoreMediaFileParams
  ): Promise<string> {
    return this.invoke(
      'storeMediaFile',
      params as unknown as Record<string, unknown>
    );
  }

  async getNumCardsReviewedByDay(): Promise<Array<[string, number]>> {
    return this.invoke('getNumCardsReviewedByDay');
  }

  async getNumCardsReviewedToday(): Promise<number> {
    return this.invoke('getNumCardsReviewedToday');
  }

  async getDeckStats(decks: string[]): Promise<Record<string, AnkiDeckStat>> {
    return this.invoke('getDeckStats', { decks });
  }

  async cardReviews(deck: string, startID: number): Promise<number[][]> {
    return this.invoke('cardReviews', { deck, startID });
  }

  async getReviewMinutesByDay(): Promise<Map<string, number>> {
    const decks = await this.deckNames();
    const minutesByDay = new Map<string, number>();
    for (const deck of decks) {
      const reviews = await this.cardReviews(deck, 0);
      for (const review of reviews) {
        const reviewTimeMs = review[0];
        const reviewDurationMs = review[7];
        if (
          typeof reviewTimeMs !== 'number' ||
          typeof reviewDurationMs !== 'number'
        ) {
          continue;
        }
        const isoDate = new Date(reviewTimeMs).toISOString().slice(0, 10);
        const prev = minutesByDay.get(isoDate) ?? 0;
        minutesByDay.set(isoDate, prev + reviewDurationMs / 60000);
      }
    }
    return minutesByDay;
  }

  async sync(): Promise<null> {
    try {
      return await this.invoke('sync', undefined, ANKI_CONNECT_SYNC_TIMEOUT_MS);
    } catch (error) {
      if (
        error instanceof AnkiConnectError &&
        error.message.includes('ChangesRequired')
      ) {
        throw new AnkiFullSyncRequiredError(error.message);
      }
      throw error;
    }
  }

  async ping(): Promise<number> {
    return this.invoke('version');
  }

  async guiBrowse(query: string): Promise<number[]> {
    return this.invoke('guiBrowse', { query });
  }

  async apiReflect(): Promise<string[]> {
    const reflection = await this.invoke<AnkiApiReflection>('apiReflect', {
      scopes: ['actions'],
      actions: null,
    });
    return Array.isArray(reflection?.actions) ? reflection.actions : [];
  }

  async notesModTime(notes: number[]): Promise<AnkiNoteModTime[]> {
    return this.invoke('notesModTime', { notes });
  }

  async multi(actions: AnkiConnectMultiAction[]): Promise<unknown[]> {
    return this.invoke('multi', { actions });
  }

  async getActiveProfile(): Promise<string> {
    return this.invoke('getActiveProfile');
  }

  async guiDeckOverview(name: string): Promise<boolean> {
    return this.invoke('guiDeckOverview', { name });
  }

  async getEaseFactors(cards: number[]): Promise<number[]> {
    return this.invoke('getEaseFactors', { cards });
  }

  async getIntervals(cards: number[], complete = false): Promise<number[]> {
    return this.invoke('getIntervals', { cards, complete });
  }

  async findCards(query: string): Promise<number[]> {
    return this.invoke('findCards', { query });
  }

  async deleteNotes(notes: number[]): Promise<null> {
    return this.invoke('deleteNotes', { notes });
  }

  async unsuspend(cards: number[]): Promise<boolean> {
    return this.invoke('unsuspend', { cards });
  }

  async removeTags(notes: number[], tags: string): Promise<null> {
    return this.invoke('removeTags', { notes, tags });
  }

  async cardsInfo(cards: number[]): Promise<AnkiCardInfo[]> {
    return this.invoke('cardsInfo', { cards });
  }

  async retrieveMediaFile(filename: string): Promise<string | false> {
    return this.invoke('retrieveMediaFile', { filename });
  }

  async answerCards(
    answers: { cardId: number; ease: number }[]
  ): Promise<boolean[]> {
    return this.invoke('answerCards', { answers });
  }

  private async invoke<T>(
    action: string,
    params?: Record<string, unknown>,
    timeoutMs: number = this.timeoutMs
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          version: ANKI_CONNECT_VERSION,
          ...(this.apiKey != null && this.apiKey.length > 0
            ? { key: this.apiKey }
            : {}),
          ...(params == null ? {} : { params }),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AnkiConnectTimeoutError(
          this.baseUrl,
          action,
          timeoutMs,
          error
        );
      }
      throw new AnkiConnectUnreachableError(this.baseUrl, error);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new AnkiConnectError(
        `AnkiConnect HTTP ${response.status} ${response.statusText}`
      );
    }

    let body: AnkiConnectResponse<T>;
    try {
      body = (await response.json()) as AnkiConnectResponse<T>;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AnkiConnectTimeoutError(
          this.baseUrl,
          action,
          timeoutMs,
          error
        );
      }
      throw new AnkiConnectUnreachableError(this.baseUrl, error);
    }
    if (body.error != null) {
      throw new AnkiConnectError(body.error);
    }
    return body.result;
  }
}

export interface AnkiConnectCardTemplate {
  Name: string;
  Front: string;
  Back: string;
}

export interface AnkiConnectCreateModelParams {
  modelName: string;
  inOrderFields: string[];
  css: string;
  isCloze?: boolean;
  cardTemplates: AnkiConnectCardTemplate[];
}

export interface AnkiConnectUpdateStylingParams {
  name: string;
  css: string;
}

export interface AnkiConnectTemplateBody {
  Front: string;
  Back: string;
}

export interface AnkiConnectUpdateTemplatesParams {
  name: string;
  templates: Record<string, AnkiConnectTemplateBody>;
}

export interface AnkiConnectStoreMediaFileParams {
  filename: string;
  data: string;
}

export interface AnkiDeckStat {
  deck_id: number;
  name: string;
  new_count: number;
  learn_count: number;
  review_count: number;
  total_in_deck?: number;
}

export interface AnkiNoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
  cards?: number[];
  mod?: number;
}

export interface AnkiCardInfo {
  cardId: number;
  note: number;
  deckName: string;
  lapses: number;
  queue: number;
  question?: string;
  answer?: string;
  css?: string;
  due?: number;
}

export interface AnkiApiReflection {
  scopes: string[];
  actions: string[];
}

export interface AnkiNoteModTime {
  noteId: number;
  mod: number;
}

export interface AnkiConnectMultiAction {
  action: string;
  params?: Record<string, unknown>;
}

export interface AnkiConnectMultiResult<T = unknown> {
  result: T;
  error: string | null;
}

export const buildAnkiConnectUrl = (host: string, port: number): string =>
  `http://${host}:${port}`;

import { getNotionObjectTitle } from 'get-notion-object-title';
import Cookies from 'universal-cookie';
import { NotionResource } from '../interfaces/NotionResource';
import JobResponse from '../../schemas/public/JobResponse';
import { JobsId } from '../../schemas/public/Jobs';
import { cancelPendingSync } from '../data_layer/userPreferencesSync';
import AnkifyClient from '../interfaces/AnkifyClient';
import { AppStoreLinks } from '../interfaces/AppStoreLinks';
import { ConnectionInfo } from '../interfaces/ConnectionInfo';
import NotionObject from '../interfaces/NotionObject';
import UserUpload from '../interfaces/UserUpload';
import isOfflineMode from '../isOfflineMode';
import getObjectIcon, { ObjectIcon } from '../notion/getObjectIcon';
import { Rules, Settings } from '../types';
import { UserNotice, isIntentionalBackendNotice } from '../errors/UserNotice';
import { AnkifyStats } from '../../pages/AnkifyPage/stats/types';
import { del, get, getLoginURL, patch, post, redirectToLogin } from './api';
import { getResourceUrl } from './getResourceUrl';
import { CONFLICT, NOT_FOUND, OK, UNAUTHORIZED } from './http';
import { ConversionReport } from '../interfaces/ConversionReport';

export class TrackerSchemaError extends Error {
  readonly missing: string[];

  constructor(message: string, missing: string[]) {
    super(message);
    this.name = 'TrackerSchemaError';
    this.missing = missing;
  }
}

export type AnkiWebSyncStatus = 'synced' | 'failed' | 'skipped';

export type DeckMaturity =
  | { connected: false }
  | {
      connected: true;
      matureCount: number;
      total: number;
      avgIntervalDays: number;
    };

export interface LeechNoteField {
  name: string;
  value: string;
}

export interface LeechNote {
  noteId: number;
  deckName: string;
  modelName: string;
  fields: LeechNoteField[];
  tags: string[];
  lapses: number;
  suspended: boolean;
}

export type LeechList =
  | { connected: false }
  | { connected: true; leeches: LeechNote[] };

export interface ReviewQueueCard {
  cardId: number;
  questionHtml: string;
  answerHtml: string;
  css: string;
}

export type ReviewQueue =
  | { connected: true; cardIds: number[] }
  | { connected: false; reason: 'offline' }
  | { connected: false; reason: 'error' };

export type ReviewCard =
  | { connected: true; card: ReviewQueueCard | null }
  | { connected: false; reason: 'offline' }
  | { connected: false; reason: 'error' };

export interface CheckoutPrices {
  cohort: 'legacy' | 'v2';
  legacy: boolean;
  monthly: { cents: number };
  annual: { cents: number };
  lockInDeadline: string | null;
}

export class Backend {
  public baseURL = '/api/';

  async logout() {
    const isOffline = isOfflineMode();
    cancelPendingSync();
    localStorage.clear();
    sessionStorage.clear();
    if (!isOffline) {
      const endpoint = `${this.baseURL}users/logout`;
      await post(endpoint, {});
    }
    const cookies = new Cookies();
    cookies.remove('token');
    globalThis.location.href = '/';
  }

  async logoutEverywhere() {
    cancelPendingSync();
    await post(`${this.baseURL}users/logout-everywhere`, {});
    localStorage.clear();
    sessionStorage.clear();
    const cookies = new Cookies();
    cookies.remove('token');
    globalThis.location.href = '/login';
  }

  async getNotionConnectionInfo(): Promise<ConnectionInfo> {
    return get(`${this.baseURL}notion/get-notion-link`);
  }

  async getAppStoreLinks(): Promise<AppStoreLinks> {
    return get(`${this.baseURL}app-store`);
  }

  saveSettings(settings: Settings) {
    return post(`${this.baseURL}settings/create/${settings.object_id}`, {
      settings,
    });
  }

  async getSettings(id: string): Promise<Settings['payload'] | null> {
    const result = await get(`${this.baseURL}settings/find/${id}`);
    if (!result) {
      return null;
    }
    return result.payload;
  }

  saveRules(
    id: string,
    flashcard: string[],
    deck: string[],
    subDecks: string[],
    tags: string,
    email: boolean
  ) {
    const payload = {
      FLASHCARD: flashcard.join(','),
      DECK: deck.join(','),
      SUB_DECKS: subDecks.join(','),
      TAGS: tags,
      EMAIL_NOTIFICATION: email,
    };
    return post(`${this.baseURL}rules/create/${id}`, { payload });
  }

  async getRules(id: string): Promise<Rules | null> {
    try {
      const findRules = async () => get(`${this.baseURL}rules/find/${id}`);
      const result = await findRules();
      if (!result) {
        return null;
      }
      return result;
    } catch (error) {
      console.error('getRules failed, falling back to empty rule', error);
      return null;
    }
  }

  deleteSettings(pageId: string) {
    return post(`${this.baseURL}settings/delete/${pageId}`, {
      object_id: pageId,
    });
  }

  async resetUserCardOptions(): Promise<void> {
    const response = await del(
      `${this.baseURL}users/me/preferences/card-options`
    );
    if (response != null && !response.ok) {
      throw new Error(`Failed to reset card options: ${response.status}`);
    }
  }

  async deleteRules(pageId: string): Promise<void> {
    const response = await del(`${this.baseURL}rules/${pageId}`);
    if (response != null && !response.ok) {
      throw new Error(`Failed to delete rules: ${response.status}`);
    }
  }

  async listSettings(): Promise<{
    items: { pageId: string; title: string | null; updatedAt: string | null }[];
  }> {
    const result = await get(`${this.baseURL}settings/list`);
    if (!result) {
      return { items: [] };
    }
    return result;
  }

  async deleteAllUserSettings(): Promise<void> {
    const response = await del(`${this.baseURL}users/me/settings`);
    if (response != null && !response.ok) {
      throw new Error(`Failed to reset all pages: ${response.status}`);
    }
  }

  async searchTopLevelPages(query: string): Promise<NotionObject[]> {
    const favorites = await this.getFavorites();
    const response = await post(`${this.baseURL}notion/top-level-pages`, {
      query,
    });
    const data = await response.json();
    if ('message' in data) {
      if (isIntentionalBackendNotice(data.message)) {
        throw new UserNotice(data.message, data.code);
      }
      throw new Error(data.message);
    }
    if (!data?.results) {
      return [];
    }
    return data.results.map(
      (p: {
        id: string;
        object: string;
        title: string;
        url: string | null;
        icon?: unknown;
        parent: { type: string };
      }) => ({
        object: p.object,
        title: p.title,
        icon: getObjectIcon(p as unknown as ObjectIcon),
        url: p.url ?? '',
        id: p.id,
        isFavorite: favorites.some((f) => f.id === p.id),
        parent: p.parent,
      })
    );
  }

  // The search POST reads its body here instead of going through api.ts's
  // taggedHttpError, so a failed response must be tagged with its status —
  // otherwise an expired session's 401 slips past reportClientError's
  // expected-client-fault filter and lands in /ops/errors as a crash.
  private searchFailure(
    status: number,
    data: { message?: unknown; code?: unknown }
  ): Error {
    const message =
      typeof data.message === 'string'
        ? data.message
        : `Search failed (${status})`;
    if (isIntentionalBackendNotice(message)) {
      return new UserNotice(
        message,
        typeof data.code === 'string' ? data.code : undefined
      );
    }
    if (status === UNAUTHORIZED) {
      redirectToLogin();
    }
    const error = new Error(message) as Error & {
      status?: number;
      method?: string;
    };
    error.status = status;
    error.method = 'POST';
    return error;
  }

  async search(query: string): Promise<NotionObject[]> {
    const favorites = await this.getFavorites();

    const isObjectId = query.replaceAll('-', '').length === 32;
    let data;
    if (isObjectId) {
      let res: NotionObject | null = null;
      try {
        res = await this.getPage(query);
      } catch {
        res = null;
      }
      if (res?.data) {
        data = { results: [res.data] };
      } else {
        let dbResult: NotionObject | null = null;
        try {
          dbResult = await this.getDatabase(query);
        } catch {
          dbResult = null;
        }
        if (dbResult?.data) {
          data = { results: [dbResult.data] };
        } else {
          data = { results: [] };
        }
      }
    } else {
      const response = await post(`${this.baseURL}notion/pages`, { query });
      data = await response.json();
      if (!response.ok) {
        throw this.searchFailure(response.status, data);
      }
    }

    if ('message' in data) {
      if (isIntentionalBackendNotice(data.message)) {
        throw new UserNotice(data.message, data.code);
      }
      throw new Error(data.message);
    }

    if (data?.results) {
      return data.results
        .map((p: NotionResource) => {
          const parentType = (p as { parent?: { type?: string } }).parent?.type;
          return {
            object: p.object,
            title: getNotionObjectTitle(p, { emoji: false }) ?? '',
            icon: getObjectIcon(p),
            url: getResourceUrl(p),
            id: p.id,
            isFavorite: favorites.some((f) => f.id === p.id),
            parent: parentType == null ? undefined : { type: parentType },
          };
        })
        .filter((entry: NotionObject) => entry.title.trim().length > 0);
    }
    return [];
  }

  async getPage(
    pageId: string,
    isFavorite: boolean = false
  ): Promise<NotionObject | null> {
    const data = await get(`${this.baseURL}notion/page/${pageId}`);
    return {
      object: data.object,
      title: getNotionObjectTitle(data, { emoji: false }),
      icon: getObjectIcon(data),
      url: data.url as string,
      id: data.id,
      data,
      isFavorite,
    };
  }

  async getDatabase(
    id: string | undefined,
    isFavorite: boolean = false
  ): Promise<NotionObject | null> {
    if (!id) {
      throw new Error('No id provided');
    }

    const data = await get(`${this.baseURL}notion/database/${id}`);
    return {
      object: data.object,
      title: getNotionObjectTitle(data, { emoji: false }),
      icon: getObjectIcon(data),
      url: data.url as string,
      id: data.id,
      data,
      isFavorite,
    };
  }

  async getDatabasePreview(id: string): Promise<DatabasePreviewResponse> {
    return get(
      `${this.baseURL}notion/database/${encodeURIComponent(id)}/preview`
    );
  }

  async getUploads(): Promise<UserUpload[]> {
    return get(`${this.baseURL}upload/mine`);
  }

  async getDropboxUploads(offset = 0): Promise<DropboxUpload[]> {
    return get(`${this.baseURL}upload/dropbox/mine?offset=${offset}`);
  }

  async deleteDropboxUpload(id: number): Promise<void> {
    const response = await del(`${this.baseURL}upload/dropbox/mine/${id}`);
    if (!response?.ok) {
      throw new Error('Failed to delete Dropbox upload');
    }
  }

  async getGoogleDriveUploads(offset = 0): Promise<GoogleDriveUpload[]> {
    return get(`${this.baseURL}upload/google_drive/mine?offset=${offset}`);
  }

  async deleteGoogleDriveUpload(id: string): Promise<void> {
    const response = await del(
      `${this.baseURL}upload/google_drive/mine/${encodeURIComponent(id)}`
    );
    if (!response?.ok) {
      throw new Error('Failed to delete Google Drive upload');
    }
  }

  async getJobs(): Promise<JobResponse[]> {
    return get(`${this.baseURL}upload/jobs`);
  }

  // 404 means "no report stored" (pre-report jobs, failed jobs) — a normal
  // state the report modal renders from the legacy signal payload instead.
  async getJobReport(jobId: string): Promise<ConversionReport | null> {
    try {
      return await get(
        `${this.baseURL}upload/jobs/${encodeURIComponent(jobId)}/report`
      );
    } catch (error) {
      if ((error as { status?: number }).status === NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Tell the backend that user wants to delete this upload.
   * @param key upload key to delete
   * @returns whether the deletion was successful or throws an error
   */
  deleteUpload(key: string): Promise<Response | null> {
    return del(`${this.baseURL}upload/mine/${key}`);
  }

  async deleteJob(id: JobsId) {
    const response = await del(`${this.baseURL}upload/jobs/${id}`);
    if (response && !response.ok) {
      if (response.status === CONFLICT) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || 'Cannot delete job while it is in progress'
        );
      }
      throw new Error(
        `Failed to delete job: ${response.status} ${response.statusText}`
      );
    }
  }

  async restartClaudeJob(jobId: string) {
    const response = await post(
      `${this.baseURL}upload/jobs/${jobId}/restart`,
      {}
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      const error = new Error(
        body.error ?? `Restart failed with status ${response.status}`
      ) as Error & { status?: number; code?: string };
      error.status = response.status;
      error.code = body.code;
      throw error;
    }
    return response;
  }

  async convert(
    id: string,
    type: string | null,
    title: string | null,
    fieldMapping?: { frontField: string; backField: string }
  ): Promise<Response> {
    const link = `${this.baseURL}notion/convert`;
    return post(link, { id, type, title, ...fieldMapping });
  }

  async addFavorite(id: string, type: string | null): Promise<boolean> {
    const response = await post(`${this.baseURL}favorite/create`, { id, type });
    if (response.status === UNAUTHORIZED) {
      redirectToLogin();
      return false;
    }
    return response.status === OK;
  }

  async deleteFavorite(id: string): Promise<boolean> {
    const response = await post(`${this.baseURL}favorite/remove`, { id });
    if (response.status === UNAUTHORIZED) {
      redirectToLogin();
      return false;
    }
    return response.status === OK;
  }

  async getFavorites(): Promise<NotionObject[]> {
    try {
      const favorites = await get(`${this.baseURL}favorite`, {
        redirect: false,
      });
      return favorites.map((f: NotionResource) => ({
        object: f,
        title: getNotionObjectTitle(f, { emoji: false }),
        icon: getObjectIcon(f),
        url: getResourceUrl(f),
        id: f.id,
        data: f,
        isFavorite: true,
      }));
    } catch (error) {
      console.error('getFavorites failed', error);
      return [];
    }
  }

  async login(email: string, password: string): Promise<Response> {
    return post(`${getLoginURL(this.baseURL)}${globalThis.location.search}`, {
      email,
      password,
    });
  }

  async requestMagicLink(
    email: string,
    purpose: 'login' | 'password_reset' = 'login',
    redirect?: string
  ): Promise<Response> {
    const body: Record<string, string> = { email, purpose };
    if (redirect != null && redirect.length > 0) {
      body.redirect = redirect;
    }
    return post(`${this.baseURL}users/magic-link`, body);
  }

  async validateMagicToken(
    token: string,
    redirect?: string
  ): Promise<Response> {
    const query =
      redirect != null && redirect.length > 0
        ? `?redirect=${encodeURIComponent(redirect)}`
        : '';
    const response = await fetch(
      `${this.baseURL}users/magic/${token}${query}`,
      {
        credentials: 'include',
      }
    );
    return response;
  }

  async forgotPassword(email: string): Promise<void> {
    const endpoint = `${this.baseURL}users/forgot-password`;
    await post(endpoint, { email });
  }

  async newPassword(password: string, token: string): Promise<Response> {
    return post(`${this.baseURL}users/new-password`, {
      password,
      reset_token: token,
    });
  }

  async register(
    name: string,
    email: string,
    password: string,
    source?: string | null
  ): Promise<Response> {
    const endpoint = `${this.baseURL}users/register`;
    const payload: Record<string, string> = { name, email, password };
    if (source != null && source.length > 0) {
      payload.source = source;
    }
    return post(endpoint, payload);
  }

  async deleteAccount(confirmed: boolean): Promise<Response> {
    return post(`${this.baseURL}users/delete-account`, { confirmed });
  }

  async markAnkifyWelcomeSeen(): Promise<void> {
    await post(`${this.baseURL}users/debug/ankify-welcome-seen`, {});
  }

  async getCheckoutPrices(): Promise<CheckoutPrices | null> {
    try {
      const body = (await get(`${this.baseURL}checkout/prices`)) as unknown;
      if (body == null || typeof body !== 'object') {
        return null;
      }
      const parsed = body as Partial<CheckoutPrices>;
      if (
        parsed.monthly?.cents == null ||
        parsed.annual?.cents == null ||
        typeof parsed.legacy !== 'boolean'
      ) {
        return null;
      }
      return {
        cohort: parsed.cohort === 'legacy' ? 'legacy' : 'v2',
        legacy: parsed.legacy,
        monthly: { cents: parsed.monthly.cents },
        annual: { cents: parsed.annual.cents },
        lockInDeadline: parsed.lockInDeadline ?? null,
      };
    } catch {
      return null;
    }
  }

  async startUnlimitedCheckout(
    interval: 'month' | 'year',
    variant?: string,
    surface?: string
  ): Promise<{ url: string } | { status: 'unavailable' | 'error' }> {
    try {
      const response = await post(`${this.baseURL}checkout/unlimited`, {
        interval,
        variant,
        surface,
      });
      if (response.status === 503) {
        return { status: 'unavailable' };
      }
      if (!response.ok) {
        return { status: 'error' };
      }
      const body = (await response.json().catch(() => null)) as {
        url?: string;
      } | null;
      if (body?.url != null) {
        return { url: body.url };
      }
      return { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  }

  async startPassCheckout(
    kind: '24h' | '7d',
    variant?: string,
    surface?: string
  ): Promise<{ url: string } | { status: 'unavailable' | 'error' }> {
    const path = kind === '24h' ? 'checkout/pass/24h' : 'checkout/pass/7d';
    try {
      const response = await post(`${this.baseURL}${path}`, {
        variant,
        surface,
      });
      if (response.status === 503) {
        return { status: 'unavailable' };
      }
      if (!response.ok) {
        return { status: 'error' };
      }
      const body = (await response.json().catch(() => null)) as {
        url?: string;
      } | null;
      if (body?.url != null) {
        return { url: body.url };
      }
      return { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  }

  async listAnkifyClients(): Promise<AnkifyClient[]> {
    const result = await get(`${this.baseURL}ankify/clients`);
    return result ?? [];
  }

  async provisionAnkifyClient(): Promise<AnkifyClient> {
    const response = await post(`${this.baseURL}ankify/clients`, {});
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      const error = new Error(
        body.message ?? 'Failed to provision client'
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async stopAnkifyClient(id: number): Promise<void> {
    const response = await del(`${this.baseURL}ankify/clients/${id}`);
    if (!response?.ok) {
      throw new Error('Failed to stop client');
    }
  }

  async respinAnkifyClient(): Promise<AnkifyClient> {
    const response = await post(`${this.baseURL}ankify/clients/respin`, {});
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? 'Failed to respin client');
    }
    return response.json();
  }

  async reissueAnkifySessionUrl(id: number): Promise<AnkifyClient> {
    const response = await post(
      `${this.baseURL}ankify/clients/${id}/reissue-session`,
      {}
    );
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? 'Failed to reissue session URL');
    }
    return response.json();
  }

  async getAnkifyExportSchedule(): Promise<{
    id: number;
    owner: number;
    database_id: string;
    time_of_day: string;
    timezone: string;
    date_range_days: number | null;
    enabled: boolean;
    last_run_at: string | null;
  } | null> {
    const result = await get(`${this.baseURL}ankify/exports/schedule`);
    return result ?? null;
  }

  async configureAnkifyExportSchedule(input: {
    databaseId: string;
    timeOfDay: string;
    timezone: string;
    dateRangeDays?: number | null;
    enabled: boolean;
  }): Promise<void> {
    const response = await post(`${this.baseURL}ankify/exports/schedule`, {
      database_id: input.databaseId,
      time_of_day: input.timeOfDay,
      timezone: input.timezone,
      date_range_days: input.dateRangeDays ?? null,
      enabled: input.enabled,
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? 'Failed to configure schedule');
    }
  }

  async deleteAnkifyExportSchedule(): Promise<void> {
    const response = await del(`${this.baseURL}ankify/exports/schedule`);
    if (!response?.ok) {
      throw new Error('Failed to delete schedule');
    }
  }

  async listAnkifySubscriptions(): Promise<
    Array<{
      id: number;
      notion_page_id: string;
      notion_page_title: string | null;
      notion_page_url: string | null;
      notion_page_icon: string | null;
      target_deck: string | null;
      enabled: boolean;
      last_polled_at: string | null;
      last_synced_at: string | null;
      last_error: string | null;
    }>
  > {
    const result = await get(`${this.baseURL}ankify/subscriptions`);
    return result ?? [];
  }

  async subscribeAnkifyNotionPage(input: {
    notionPageId: string;
    notionPageTitle?: string | null;
    notionPageUrl?: string | null;
    notionPageIcon?: string | null;
    targetDeck?: string | null;
  }): Promise<{
    created: number;
    updated: number;
    conflicts: number;
    unchanged: number;
    errors: string[];
    anki_web_sync: AnkiWebSyncStatus;
    anki_web_sync_error: string | null;
    diagnostic: {
      blocks_scanned: number;
      blocks_matched: number;
      pattern_hits: Record<string, number>;
      unmatched_samples?: string[];
    } | null;
  }> {
    const response = await post(`${this.baseURL}ankify/subscriptions`, {
      notion_page_id: input.notionPageId,
      notion_page_title: input.notionPageTitle,
      notion_page_url: input.notionPageUrl,
      notion_page_icon: input.notionPageIcon,
      ...(input.targetDeck === undefined
        ? {}
        : { target_deck: input.targetDeck ?? '' }),
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      const error = new Error(
        body.message ?? 'Failed to subscribe page'
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async deleteAnkifySubscription(id: number): Promise<void> {
    const response = await del(`${this.baseURL}ankify/subscriptions/${id}`);
    if (!response?.ok) {
      throw new Error('Failed to delete subscription');
    }
  }

  async refreshAnkifySubscription(id: number): Promise<{
    created: number;
    updated: number;
    conflicts: number;
    unchanged: number;
    errors: string[];
    anki_web_sync: AnkiWebSyncStatus;
    anki_web_sync_error: string | null;
    diagnostic: {
      blocks_scanned: number;
      blocks_matched: number;
      pattern_hits: Record<string, number>;
      unmatched_samples?: string[];
    } | null;
  }> {
    const response = await post(
      `${this.baseURL}ankify/subscriptions/${id}/refresh`,
      {}
    );
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      const error = new Error(
        body.message ?? 'Failed to update deck'
      ) as Error & {
        status?: number;
        retryAfterSeconds?: number;
      };
      error.status = response.status;
      if (typeof body.retry_after_seconds === 'number') {
        error.retryAfterSeconds = body.retry_after_seconds;
      }
      throw error;
    }
    return response.json();
  }

  async listAnkifyConflicts(): Promise<
    Array<{
      id: number;
      source_id: string;
      anki_note_id: number;
      kind: string;
      notion_snapshot: { front?: string; back?: string } | null;
      anki_snapshot: { front?: string; back?: string } | null;
      created_at: string;
    }>
  > {
    const result = await get(`${this.baseURL}ankify/conflicts?status=pending`);
    return result ?? [];
  }

  async resolveAnkifyConflict(
    id: number,
    resolution: 'keep_notion' | 'keep_anki' | 'dismissed'
  ): Promise<void> {
    const response = await post(
      `${this.baseURL}ankify/conflicts/${id}/resolve`,
      { resolution }
    );
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? 'Failed to resolve conflict');
    }
  }

  async openAnkifyConflictInAnki(id: number): Promise<{ opened: boolean }> {
    const response = await post(
      `${this.baseURL}ankify/conflicts/${id}/open-in-anki`,
      {}
    );
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? 'Failed to open in Anki');
    }
    const body = await response.json().catch(() => ({ opened: false }));
    return { opened: body.opened === true };
  }

  async checkAnkifyActiveClientReady(): Promise<{
    ready: boolean;
    reason?: 'no_active_client' | 'unreachable' | 'error';
    detail?: string;
  }> {
    const result = await get(`${this.baseURL}ankify/clients/active/ready`);
    return result ?? { ready: false, reason: 'unreachable' };
  }

  async checkAnkifyAnkiWebStatus(): Promise<{
    status:
      | 'linked'
      | 'unlinked'
      | 'unreachable'
      | 'no_active_client'
      | 'error';
    message?: string;
  }> {
    const result = await get(
      `${this.baseURL}ankify/clients/active/anki-web-status`
    );
    return result ?? { status: 'unreachable' };
  }

  async getAnkifyStats(): Promise<AnkifyStats> {
    const result = await get(`${this.baseURL}ankify/stats`);
    return result ?? { connected: false };
  }

  async getAnkifyActiveProfile(): Promise<string | null> {
    try {
      const result = await get(`${this.baseURL}ankify/active-profile`, {
        redirect: false,
      });
      const profile = result?.profile;
      return typeof profile === 'string' && profile.length > 0 ? profile : null;
    } catch {
      return null;
    }
  }

  async syncAnkifyToAnkiWeb(): Promise<void> {
    const response = await post(`${this.baseURL}ankify/sync-to-ankiweb`, {});
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(body.message ?? 'Failed to sync to AnkiWeb');
    }
  }

  async openAnkifyDeckInAnki(deck: string): Promise<{ opened: boolean }> {
    const response = await post(`${this.baseURL}ankify/gui-deck-overview`, {
      deck,
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(body.message ?? 'Failed to open in Anki');
    }
    const body = await response.json().catch(() => ({ opened: false }));
    return { opened: body.opened === true };
  }

  async getAnkifyDeckMaturity(deck: string): Promise<DeckMaturity> {
    try {
      const result = await get(
        `${this.baseURL}ankify/deck-maturity?deck=${encodeURIComponent(deck)}`,
        { redirect: false }
      );
      if (result?.connected === true) {
        return {
          connected: true,
          matureCount: Number(result.matureCount ?? 0),
          total: Number(result.total ?? 0),
          avgIntervalDays: Number(result.avgIntervalDays ?? 0),
        };
      }
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async listAnkifyLeeches(): Promise<LeechList> {
    const result = await get(`${this.baseURL}ankify/leeches`);
    if (result?.connected === true && Array.isArray(result.leeches)) {
      return { connected: true, leeches: result.leeches };
    }
    return { connected: false };
  }

  async editAnkifyLeech(
    noteId: number,
    fields: Record<string, string>
  ): Promise<void> {
    const response = await patch(`${this.baseURL}ankify/leeches/${noteId}`, {
      fields,
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      const error = new Error(
        body.message ?? 'Failed to edit card'
      ) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
  }

  async deleteAnkifyLeech(noteId: number): Promise<void> {
    const response = await del(`${this.baseURL}ankify/leeches/${noteId}`);
    if (!response?.ok) {
      const error = new Error('Failed to delete card') as Error & {
        status?: number;
      };
      error.status = response?.status;
      throw error;
    }
  }

  async getAnkifyReviewQueue(deck: string): Promise<ReviewQueue> {
    try {
      const result = await get(
        `${this.baseURL}ankify/review-queue?deck=${encodeURIComponent(deck)}`,
        { redirect: false }
      );
      if (result?.connected === true && Array.isArray(result.cardIds)) {
        return { connected: true, cardIds: result.cardIds };
      }
      return { connected: false, reason: 'offline' };
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status === 503 || status === 0) {
        return { connected: false, reason: 'offline' };
      }
      return { connected: false, reason: 'error' };
    }
  }

  async getAnkifyReviewCard(cardId: number): Promise<ReviewCard> {
    try {
      const result = await get(
        `${this.baseURL}ankify/review-card?cardId=${cardId}`,
        { redirect: false }
      );
      if (result?.connected === true) {
        return { connected: true, card: result.card ?? null };
      }
      return { connected: false, reason: 'offline' };
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status === 503 || status === 0) {
        return { connected: false, reason: 'offline' };
      }
      return { connected: false, reason: 'error' };
    }
  }

  async gradeAnkifyReviewCard(cardId: number, ease: number): Promise<void> {
    const response = await post(`${this.baseURL}ankify/review-grade`, {
      cardId,
      ease,
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      const error = new Error(
        body.message ?? 'Failed to grade card'
      ) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
  }

  async returnAnkifyLeechToReview(noteId: number): Promise<void> {
    const response = await post(
      `${this.baseURL}ankify/leeches/${noteId}/return-to-review`,
      {}
    );
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      const error = new Error(
        body.message ?? 'Failed to return card to review'
      ) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
  }

  async listAnkifyNotionDatabases(): Promise<
    Array<{
      id: string;
      title: string;
      url: string | null;
      has_review_shape: boolean;
    }>
  > {
    const result = await get(`${this.baseURL}ankify/notion/databases`);
    return result ?? [];
  }

  async createAnkifyReviewTracker(input: {
    parentPageId: string;
    title?: string;
  }): Promise<{ id: string; url: string | null; title: string }> {
    const response = await post(`${this.baseURL}ankify/notion/databases`, {
      parent_page_id: input.parentPageId,
      title: input.title,
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? 'Failed to create tracker database');
    }
    return response.json();
  }

  async exportAnkifyReviewData(input: {
    databaseId: string;
    dateRangeDays?: number;
  }): Promise<{
    exported: number;
    skipped: number;
    errors: string[];
    totalDays: number;
  }> {
    const response = await post(`${this.baseURL}ankify/exports/review-data`, {
      database_id: input.databaseId,
      date_range_days: input.dateRangeDays,
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      if (response.status === 422 && Array.isArray(error.missing)) {
        throw new TrackerSchemaError(
          error.message ?? 'Tracker is missing required columns',
          error.missing as string[]
        );
      }
      throw new Error(error.message ?? 'Failed to export review data');
    }
    return response.json();
  }

  async dispatchUploadToAnkify(uploadId: number): Promise<{
    deck_names: string[];
    created: number;
    updated: number;
    errors: string[];
    anki_web_sync: AnkiWebSyncStatus;
    anki_web_sync_error: string | null;
  }> {
    const response = await post(`${this.baseURL}ankify/dispatch`, {
      upload_id: uploadId,
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? 'Failed to dispatch upload');
    }
    return response.json();
  }

  async startImportToNotion(
    file: File,
    notionPageId?: string
  ): Promise<{ job_id: string }> {
    const formData = new FormData();
    formData.append('file', file);
    if (notionPageId != null && notionPageId.length > 0) {
      formData.append('parent_page_id', notionPageId);
    }

    const response = await fetch(`${this.baseURL}apkg/import`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? 'Failed to start import');
    }
    return response.json();
  }

  async getImportJobStatus(jobId: string): Promise<{
    status: string;
    progress: { total_notes: number; imported: number };
    status_text?: string;
    notion_page_url?: string;
    error?: string;
    truncated?: boolean;
  }> {
    return get(`${this.baseURL}apkg/import/${jobId}/status`);
  }

  async contactUs(
    name: string,
    email: string,
    message: string,
    files?: File[],
    website?: string
  ): Promise<void> {
    const form = new FormData();
    form.append('name', name);
    form.append('email', email);
    form.append('message', message);
    form.append('website', website ?? '');
    for (const file of files ?? []) {
      form.append('attachments', file);
    }
    const response = await fetch(`${this.baseURL}contact-us`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
  }

  async submitEmojiFeedback(
    rating: number,
    page: string,
    comment?: string,
    email?: string
  ): Promise<void> {
    const response = await post(`${this.baseURL}emoji-feedback`, {
      rating,
      page,
      comment: comment ?? null,
      email: email ?? null,
    });
    if (!response.ok) {
      throw new Error('Failed to submit feedback');
    }
  }

  async recordFeatureInterest(
    featureKey: string,
    comment?: string
  ): Promise<void> {
    const response = await post(`${this.baseURL}feature-interest`, {
      feature_key: featureKey,
      comment: comment ?? null,
    });
    if (!response.ok) {
      throw new Error('Failed to record interest');
    }
  }

  async listContactMessages(): Promise<ContactMessage[]> {
    return get(`${this.baseURL}ops/contact-messages`);
  }

  async acknowledgeContactMessage(
    id: number,
    isAcknowledged = true
  ): Promise<void> {
    const response = await fetch(
      `${this.baseURL}ops/contact-messages/${id}/acknowledge`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_acknowledged: isAcknowledged }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to acknowledge message');
    }
  }

  async getPitchEligibility(): Promise<PitchEligibility> {
    return get(`${this.baseURL}pitches/auto-sync`, { redirect: false });
  }

  async dismissPitch(placement: string): Promise<void> {
    await post(`${this.baseURL}pitches/dismiss`, { placement });
  }
}

export interface PitchEligibility {
  convertSuccess: boolean;
  accountBanner: boolean;
  producerPrompt: boolean;
}

export interface DropboxUpload {
  id: number;
  bytes: number;
  name: string;
  created_at: string | null;
}

export interface GoogleDriveUpload {
  id: string;
  iconUrl: string;
  mimeType: string;
  name: string;
  sizeBytes: string | null;
  url: string;
  last_converted_at: string | null;
}

export interface DatabasePreviewMapping {
  frontField: string | null;
  backField: string | null;
  ambiguous: boolean;
}

export interface DatabasePreviewSample {
  id: string;
  values: Record<string, string>;
}

export interface DatabasePreviewResponse {
  title: string;
  url: string | null;
  columns: string[];
  mapping: DatabasePreviewMapping;
  samples: DatabasePreviewSample[];
  rowCount: number;
  hasMore: boolean;
}

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  message: string;
  attachments: string | null;
  is_acknowledged: boolean;
  created_at: string;
}

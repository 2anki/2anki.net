import { APIErrorCode } from '@notionhq/client';

import { INotionRepository } from '../../data_layer/NotionRespository';
import instrumentedAxios from '../observability/instrumentedAxios';
import type { IBlocksCacheRepository } from '../../data_layer/BlocksCacheRepository';
import {
  INotionTopLevelPagesRepository,
  NotionTopLevelPageRow,
} from '../../data_layer/NotionTopLevelPagesRepository';
import hashToken from '../../lib/misc/hashToken';
import { buildNativeOAuthState } from './nativeOAuthState';
import NotionAPIWrapper from './NotionAPIWrapper';
import { getNotionId } from './getNotionId';
import {
  getTopLevelPagesCache,
  invalidateTopLevelPagesForOwner,
  setTopLevelPagesCache,
} from './topLevelPagesCache';
import { releaseRefresh, tryClaimRefresh } from './topLevelPagesRefreshGate';

export interface NotionLinkInfo {
  link: string;
  isConnected: boolean;
  workspace: string | null;
}

export const TOP_LEVEL_PAGES_STALE_AFTER_MS = 5 * 60 * 1000;

interface TopLevelPagesResult {
  results: Array<{
    id: string;
    object: 'page' | 'database';
    url: string | null;
    icon: unknown;
    title: string;
    parent: { type: string };
  }>;
}

export class NotionService {
  clientId: string;

  clientSecret: string;

  redirectURI: string;

  constructor(
    private readonly notionRepository: INotionRepository,
    private readonly topLevelPagesRepository?: INotionTopLevelPagesRepository,
    private readonly blocksCacheRepository?: IBlocksCacheRepository
  ) {
    this.clientId = process.env.NOTION_CLIENT_ID!;
    this.clientSecret = process.env.NOTION_CLIENT_SECRET!;
    this.redirectURI = process.env.NOTION_REDIRECT_URI!;
  }

  getNotionAuthorizationLink(clientId: string, state?: string) {
    const params = new URLSearchParams({
      owner: 'user',
      client_id: clientId,
      response_type: 'code',
      redirect_uri: this.redirectURI,
    });
    if (state) {
      params.set('state', state);
    }
    return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  }

  isValidUUID(id: string | undefined | null) {
    if (!id) {
      return false;
    }

    const regex =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    return regex.exec(id);
  }

  getNotionAPI = async (owner: string): Promise<NotionAPIWrapper> => {
    const token = await this.notionRepository.getNotionToken(owner);
    if (!token) {
      throw new Error(APIErrorCode.Unauthorized);
    }
    return new NotionAPIWrapper(token, owner, this.blocksCacheRepository);
  };

  tryGetNotionAPI = async (owner: string): Promise<NotionAPIWrapper | null> => {
    const token = await this.notionRepository.getNotionToken(owner);
    if (!token) {
      return null;
    }
    return new NotionAPIWrapper(token, owner, this.blocksCacheRepository);
  };

  async getNotionDatabaseBlock(id: string, owner: string) {
    let cleanId = id.replace(/-/g, '');

    if (cleanId.includes('/')) {
      cleanId = getNotionId(id) ?? cleanId;
    }

    const client = await this.getNotionAPI(owner);

    return client.getDatabase(cleanId);
  }

  async search(query: string, owner: string) {
    const client = await this.getNotionAPI(owner);
    return client.search(query);
  }

  async searchTopLevelPages(
    query: string,
    owner: string | number,
    opts: { maxResults?: number; maxPages?: number } = {}
  ): Promise<TopLevelPagesResult> {
    const ownerId = typeof owner === 'number' ? owner : Number(owner);
    const normalisedQuery = query.trim();

    const cached = getTopLevelPagesCache<TopLevelPagesResult>(
      ownerId,
      normalisedQuery
    );
    if (cached) return cached;

    if (normalisedQuery === '' && this.topLevelPagesRepository) {
      const tier2 = await this.tier2Read(ownerId);
      if (tier2) {
        setTopLevelPagesCache(ownerId, normalisedQuery, tier2);
        return tier2;
      }
    }

    const client = await this.getNotionAPI(String(owner));
    const live = await client.searchTopLevelPages(query, opts);

    setTopLevelPagesCache(ownerId, normalisedQuery, live);

    if (normalisedQuery === '' && this.topLevelPagesRepository) {
      try {
        await this.topLevelPagesRepository.replaceForOwnerIfTokenStillValid(
          ownerId,
          live.results.map((r) => toRow(ownerId, r))
        );
      } catch (error) {
        console.error('[notion] tier2 cold-fill failed', error);
      }
    }

    return live;
  }

  private async tier2Read(owner: number): Promise<TopLevelPagesResult | null> {
    if (!this.topLevelPagesRepository) return null;
    const rows = await this.topLevelPagesRepository.getByOwner(owner);
    if (rows.length === 0) return null;

    const newest = Math.max(
      ...rows.map((r) => new Date(r.cached_at).getTime())
    );
    const isStale = Date.now() - newest > TOP_LEVEL_PAGES_STALE_AFTER_MS;

    if (isStale) {
      this.scheduleBackgroundRefresh(owner);
    }

    return {
      results: rows.map((r) => ({
        id: r.notion_page_id,
        object: 'page' as const,
        url: r.url,
        icon: r.icon,
        title: r.title,
        parent: { type: r.parent_type },
      })),
    };
  }

  private scheduleBackgroundRefresh(owner: number): void {
    if (!tryClaimRefresh(owner)) return;
    void this.runRefresh(owner).finally(() => releaseRefresh(owner));
  }

  private async runRefresh(owner: number): Promise<void> {
    if (!this.topLevelPagesRepository) return;
    try {
      const client = await this.tryGetNotionAPI(String(owner));
      if (!client) return;
      const live = await client.searchTopLevelPages('');
      const wrote =
        await this.topLevelPagesRepository.replaceForOwnerIfTokenStillValid(
          owner,
          live.results.map((r) => toRow(owner, r))
        );
      if (wrote) {
        invalidateTopLevelPagesForOwner(owner);
      }
    } catch (error) {
      console.error('[notion] tier2 refresh failed', error);
    }
  }

  refreshTopLevelPagesCache(owner: number): Promise<void> {
    return new Promise((resolve) => {
      if (!tryClaimRefresh(owner)) {
        resolve();
        return;
      }
      this.runRefresh(owner).finally(() => {
        releaseRefresh(owner);
        resolve();
      });
    });
  }

  async connectToNotion(authorizationCode: string, owner: number) {
    const accessData = await this.getAccessData(authorizationCode.toString());
    await this.notionRepository.saveNotionToken(owner, accessData, hashToken);
    if (this.topLevelPagesRepository) {
      void this.refreshTopLevelPagesCache(owner).catch((error) => {
        console.error('[notion] connect-time pre-warm failed', error);
      });
    }
  }

  async getNotionLinkInfo(
    owner: number,
    { client }: { client?: 'native' } = {}
  ): Promise<NotionLinkInfo> {
    const notionData = await this.notionRepository.getNotionData(owner);
    const clientId = this.clientId;
    const link =
      client === 'native'
        ? this.getNotionAuthorizationLink(
            clientId,
            buildNativeOAuthState(owner, process.env.SECRET ?? '')
          )
        : this.getNotionAuthorizationLink(clientId);

    if (!notionData) {
      return {
        link,
        isConnected: false,
        workspace: null,
      };
    }

    const tokenValid = !!notionData.token && notionData.invalidated_at == null;
    return {
      link,
      isConnected: tokenValid,
      workspace: notionData.workspace_name,
    };
  }

  getAccessData(code: string): Promise<{ [key: string]: string }> {
    const uri = this.redirectURI;
    const id = this.clientId;
    const secret = this.clientSecret;

    if (!uri || !id || !secret) {
      throw new Error('Notion Connection Handler not configured');
    }

    return new Promise((resolve, reject) => {
      const url = 'https://api.notion.com/v1/oauth/token';
      const data = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: uri,
      };
      const options = {
        auth: {
          username: id,
          password: secret,
        },
        headers: { 'Content-Type': 'application/json' },
      };

      instrumentedAxios
        .post<{ access_token?: string }>('notion', url, data, options)
        .then((res) => {
          if (res.data.access_token) {
            resolve(res.data as { [key: string]: string });
          }
        })
        .catch((err) => {
          console.info('Get access data failed');
          console.error(err);
          reject(err);
        });
    });
  }

  markTokenInvalid(owner: number): Promise<void> {
    return this.notionRepository.markTokenInvalid(owner);
  }

  purgeBlockCache(owner: number) {
    return this.notionRepository.deleteBlocksByOwner(owner);
  }

  getClientId() {
    return this.clientId;
  }

  async disconnect(owner: number) {
    invalidateTopLevelPagesForOwner(owner);
    if (this.topLevelPagesRepository) {
      try {
        await this.topLevelPagesRepository.deleteByOwner(owner);
      } catch (error) {
        console.error('[notion] tier2 disconnect cleanup failed', error);
      }
    }
    return this.notionRepository.deleteNotionData(owner);
  }
}

function toRow(
  owner: number,
  page: {
    id: string;
    title: string;
    icon: unknown;
    url: string | null;
    parent: { type: string };
  }
): NotionTopLevelPageRow {
  return {
    owner,
    notion_page_id: page.id,
    title: page.title,
    icon: page.icon ?? null,
    url: page.url,
    parent_type: page.parent.type,
    last_edited_time: null,
    cached_at: new Date(),
  };
}

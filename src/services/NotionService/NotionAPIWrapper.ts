import {
  APIErrorCode,
  APIResponseError,
  Client,
  isFullDatabase,
} from '@notionhq/client';
import {
  BlockObjectRequest,
  CreatePageResponse,
  GetBlockResponse,
  GetDatabaseResponse,
  GetPageResponse,
  ListBlockChildrenResponse,
  QueryDataSourceResponse,
  SearchResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { CreateFileUploadResponse } from '@notionhq/client/build/src/api-endpoints/file-uploads';
import { getNotionObjectTitle } from 'get-notion-object-title';

import sanitizeTags from '../../lib/anki/sanitizeTags';
import ParserRules from '../../lib/parser/ParserRules';
import CardOption from '../../lib/parser/Settings/CardOption';
import { getParagraphBlocks } from './helpers/getParagraphBlocks';
import renderIcon from './helpers/renderIcon';
import getBlockIcon, { WithIcon } from './blocks/getBlockIcon';
import { uniqueTimerLabel } from './helpers/uniqueTimerLabel';
import { withRetry } from './helpers/withRetry';
import { fetchPageOrStopOnCursorInvalidation } from './helpers/tolerateCursorInvalidation';
import { collapseDataSourcesToDatabases } from './helpers/collapseDataSourcesToDatabases';
import type { IBlocksCacheRepository } from '../../data_layer/BlocksCacheRepository';
import { isValidNotionId } from './isValidNotionId';
import { ValidNotionType } from './types';
import { notionCallRingBuffer } from './NotionCallRingBuffer';
import { sanitizeForLog } from '../../lib/log/sanitizeForLog';

const DEFAULT_PAGE_SIZE_LIMIT = 100 * 2;
const SEARCH_MAX_PAGES = 20;

export interface GetBlockParams {
  createdAt: string;
  lastEditedAt: string;
  id: string;
  type: ValidNotionType;
  all?: boolean;
}

class NotionAPIWrapper {
  private notion: Client;

  page?: GetPageResponse;

  private owner: string;

  private blocksCache?: IBlocksCacheRepository;

  private forbiddenBlockIds = new Set<string>();

  constructor(
    key: string,
    owner: string,
    blocksCache?: IBlocksCacheRepository
  ) {
    this.notion = new Client({ auth: key });
    this.owner = owner;
    this.blocksCache = blocksCache;
  }

  get forbiddenBlockCount(): number {
    return this.forbiddenBlockIds.size;
  }

  // Notion answers 403 restricted_resource for blocks the integration can see
  // but not read, and 404 object_not_found for content it cannot see at all —
  // unshared synced-block sources arrive as the 404 flavor. Both mean the same
  // thing to the user: part of the page is not connected to 2anki (#4174).
  private recordIfForbidden(id: string, error: unknown): void {
    if (!(error instanceof APIResponseError)) return;
    const forbidden =
      (error.status === 403 &&
        error.code === APIErrorCode.RestrictedResource) ||
      (error.status === 404 && error.code === APIErrorCode.ObjectNotFound);
    if (forbidden) {
      this.forbiddenBlockIds.add(id);
    }
  }

  getPage(id: string): Promise<GetPageResponse | null> {
    if (!isValidNotionId(id)) {
      console.info(
        '[notion] skipping pages.retrieve for non-UUID id:',
        sanitizeForLog(id)
      );
      return Promise.resolve(null);
    }
    return withRetry(() => this.notion.pages.retrieve({ page_id: id }), {
      label: 'pages.retrieve',
    }).then((result) => {
      notionCallRingBuffer.record();
      return result;
    });
  }

  async getBlocks({
    createdAt,
    lastEditedAt,
    id,
    all,
    type,
  }: GetBlockParams): Promise<ListBlockChildrenResponse> {
    if (type === 'unsupported') {
      return {
        type: 'block',
        block: {},
        object: 'list',
        next_cursor: null,
        has_more: false,
        results: [],
      };
    }

    const getBlocksLabel = uniqueTimerLabel(`getBlocks:${id}${all}`);
    console.time(getBlocksLabel);

    const cachedPayload =
      all && this.blocksCache
        ? await this.blocksCache.get({
            id,
            owner: this.owner,
            lastEditedAt,
          })
        : null;
    if (cachedPayload) {
      console.log('using payload cache');
      console.timeEnd(getBlocksLabel);
      return cachedPayload;
    }
    let response: ListBlockChildrenResponse;
    try {
      response = await withRetry(
        () =>
          this.notion.blocks.children.list({
            block_id: id,
            page_size: DEFAULT_PAGE_SIZE_LIMIT,
          }),
        { label: 'blocks.children.list' }
      );
    } catch (error) {
      this.recordIfForbidden(id, error);
      throw error;
    }
    console.log('received', response.results.length, 'blocks');

    let paginationTruncated = false;
    if (all && response.has_more && response.next_cursor) {
      while (true) {
        const nextPage = await fetchPageOrStopOnCursorInvalidation(
          () =>
            withRetry(
              () =>
                this.notion.blocks.children.list({
                  block_id: id,
                  start_cursor: response.next_cursor!,
                }),
              { label: 'blocks.children.list:page' }
            ),
          true,
          'blocks.children.list'
        );
        if (nextPage == null) {
          paginationTruncated = true;
          break;
        }
        const { results, next_cursor: nextCursor } = nextPage;
        console.log('found more', results.length, 'blocks');
        response.results.push(...results);
        if (nextCursor) {
          response.next_cursor = nextCursor;
        } else {
          console.log('done getting blocks');
          break;
        }
      }
    }
    if (createdAt && lastEditedAt) {
      if (this.blocksCache && !paginationTruncated) {
        await this.blocksCache.save({
          id,
          owner: this.owner,
          payload: response,
          createdAt,
          lastEditedAt,
        });
      }
    } else {
      console.log('not enough input block cache');
    }
    console.timeEnd(getBlocksLabel);
    return response;
  }

  async getBlock(id: string): Promise<GetBlockResponse> {
    try {
      return await withRetry(
        () => this.notion.blocks.retrieve({ block_id: id }),
        { label: 'blocks.retrieve' }
      );
    } catch (error) {
      this.recordIfForbidden(id, error);
      throw error;
    }
  }

  /**
   * Cursor-paginated block fetch for streaming previews. Does NOT touch the
   * block cache (preview is a view-only concern, and we want fresh cursor
   * boundaries on each call) and does NOT auto-exhaust pagination.
   */
  listBlocksPage(
    id: string,
    options: { pageSize?: number; startCursor?: string } = {}
  ): Promise<ListBlockChildrenResponse> {
    return withRetry(
      () =>
        this.notion.blocks.children.list({
          block_id: id,
          page_size: options.pageSize ?? 15,
          ...(options.startCursor ? { start_cursor: options.startCursor } : {}),
        }),
      { label: 'blocks.children.list:preview' }
    );
  }

  deleteBlock(id: string): Promise<GetBlockResponse> {
    return this.notion.blocks.delete({
      block_id: id,
    });
  }

  createBlock(
    parent: string,
    newBlock: BlockObjectRequest
  ): Promise<ListBlockChildrenResponse> {
    return this.notion.blocks.children.append({
      block_id: parent,
      children: [newBlock],
    });
  }

  appendBlocks(
    parentId: string,
    children: BlockObjectRequest[]
  ): Promise<ListBlockChildrenResponse> {
    return withRetry(
      () =>
        this.notion.blocks.children.append({
          block_id: parentId,
          children,
        }),
      { label: 'blocks.children.append:batch' }
    );
  }

  createPage(parentPageId: string, title: string): Promise<CreatePageResponse> {
    return withRetry(
      () =>
        this.notion.pages.create({
          parent: { page_id: parentPageId },
          properties: {
            title: {
              type: 'title',
              title: [{ text: { content: title } }],
            },
          },
        }),
      { label: 'pages.create' }
    );
  }

  async uploadFile(
    filename: string,
    contentType: string,
    data: Buffer
  ): Promise<string> {
    const created = await this.notion.fileUploads.create({
      mode: 'single_part',
      filename,
      content_type: contentType,
    });

    const blob = new Blob([new Uint8Array(data)], { type: contentType });

    await this.notion.fileUploads.send({
      file_upload_id: created.id,
      file: { data: blob, filename },
    });

    return created.id;
  }

  getDatabase(id: string): Promise<GetDatabaseResponse> {
    return withRetry(
      () => this.notion.databases.retrieve({ database_id: id }),
      { label: 'databases.retrieve' }
    );
  }

  async queryDatabasePreview(
    id: string,
    pageSize: number
  ): Promise<{ results: unknown[]; hasMore: boolean }> {
    const queryLabel = uniqueTimerLabel(`queryDatabasePreview:${id}`);
    console.time(queryLabel);

    const database = await withRetry(
      () => this.notion.databases.retrieve({ database_id: id }),
      { label: 'databases.retrieve:queryDatabasePreview' }
    );
    const dataSources = isFullDatabase(database) ? database.data_sources : [];

    if (dataSources.length === 0) {
      console.timeEnd(queryLabel);
      return { results: [], hasMore: false };
    }

    const firstDataSource = dataSources[0];
    const response = await withRetry(
      () =>
        this.notion.dataSources.query({
          data_source_id: firstDataSource.id,
          page_size: pageSize,
        }),
      { label: 'dataSources.query:preview' }
    );

    console.timeEnd(queryLabel);
    return {
      results: response.results,
      hasMore: response.has_more,
    };
  }

  async queryDatabase(
    id: string,
    all?: boolean
  ): Promise<QueryDataSourceResponse> {
    const queryLabel = uniqueTimerLabel(`queryDatabase:${id}${all}`);
    console.time(queryLabel);

    const database = await withRetry(
      () => this.notion.databases.retrieve({ database_id: id }),
      { label: 'databases.retrieve:queryDatabase' }
    );
    const dataSources = isFullDatabase(database) ? database.data_sources : [];

    const aggregated: QueryDataSourceResponse = {
      object: 'list',
      type: 'page_or_data_source',
      page_or_data_source: {},
      results: [],
      next_cursor: null,
      has_more: false,
    };

    for (const dataSource of dataSources) {
      let cursor: string | null = null;
      do {
        const response: QueryDataSourceResponse | null =
          await fetchPageOrStopOnCursorInvalidation(
            () =>
              withRetry(
                () =>
                  this.notion.dataSources.query({
                    data_source_id: dataSource.id,
                    page_size: DEFAULT_PAGE_SIZE_LIMIT,
                    ...(cursor ? { start_cursor: cursor } : {}),
                  }),
                { label: 'dataSources.query' }
              ),
            cursor != null,
            'dataSources.query'
          );
        if (response == null) {
          break;
        }
        aggregated.results.push(...response.results);
        cursor = all && response.has_more ? response.next_cursor : null;
      } while (cursor);
    }

    console.timeEnd(queryLabel);
    return aggregated;
  }

  async searchTopLevelPages(
    query: string,
    opts: { maxResults?: number; maxPages?: number } = {}
  ): Promise<{
    results: Array<{
      id: string;
      object: 'page' | 'database';
      url: string | null;
      icon: unknown;
      title: string;
      parent: { type: string };
    }>;
  }> {
    const maxResults = opts.maxResults ?? 50;
    const maxPages = opts.maxPages ?? 20;
    const collected: Array<{
      id: string;
      object: 'page' | 'database';
      url: string | null;
      icon: unknown;
      title: string;
      parent: { type: string };
    }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const response = await fetchPageOrStopOnCursorInvalidation(
        () =>
          withRetry(
            () =>
              this.notion.search({
                page_size: DEFAULT_PAGE_SIZE_LIMIT,
                query,
                filter: { value: 'page', property: 'object' },
                sort: {
                  direction: 'descending',
                  timestamp: 'last_edited_time',
                },
                ...(cursor ? { start_cursor: cursor } : {}),
              }),
            { label: 'searchTopLevelPages' }
          ),
        cursor != null,
        'searchTopLevelPages'
      );
      if (response == null) {
        break;
      }
      for (const entry of response.results) {
        const e = entry as {
          id: string;
          object: string;
          url?: string;
          icon?: unknown;
          parent?: { type?: string };
        };
        const parentType = e.parent?.type;
        if (parentType === 'database_id' || parentType === 'data_source_id') {
          continue;
        }
        const title = (
          getNotionObjectTitle(entry as never, { emoji: false }) ?? ''
        ).trim();
        if (title.length === 0) {
          continue;
        }
        collected.push({
          id: e.id,
          object: 'page',
          url: e.url ?? null,
          icon: e.icon,
          title,
          parent: { type: parentType ?? 'workspace' },
        });
        if (collected.length >= maxResults) {
          return { results: collected };
        }
      }
      if (!response.has_more || response.next_cursor == null) {
        break;
      }
      cursor = response.next_cursor;
    }

    const databases = await this.searchTopLevelDatabases(query, maxResults);
    collected.push(...databases);

    return { results: collected };
  }

  private async searchTopLevelDatabases(
    query: string,
    maxResults: number
  ): Promise<
    Array<{
      id: string;
      object: 'database';
      url: string | null;
      icon: unknown;
      title: string;
      parent: { type: string };
    }>
  > {
    const response: SearchResponse = await withRetry(
      () =>
        this.notion.search({
          page_size: DEFAULT_PAGE_SIZE_LIMIT,
          query,
          filter: { value: 'data_source', property: 'object' },
          sort: {
            direction: 'descending',
            timestamp: 'last_edited_time',
          },
        }),
      { label: 'searchTopLevelDatabases' }
    );

    const collapsed = collapseDataSourcesToDatabases(response);
    const databases: Array<{
      id: string;
      object: 'database';
      url: string | null;
      icon: unknown;
      title: string;
      parent: { type: string };
    }> = [];
    for (const entry of collapsed.results) {
      const e = entry as {
        id: string;
        object: string;
        url?: string;
        icon?: unknown;
        parent?: { type?: string };
      };
      if (e.object !== 'database') {
        continue;
      }
      const title = (
        getNotionObjectTitle(entry as never, { emoji: false }) ?? ''
      ).trim();
      if (title.length === 0) {
        continue;
      }
      databases.push({
        id: e.id,
        object: 'database',
        url: e.url ?? null,
        icon: e.icon,
        title,
        parent: { type: e.parent?.type ?? 'workspace' },
      });
      if (databases.length >= maxResults) {
        break;
      }
    }
    return databases;
  }

  async search(query: string) {
    const searchLabel = uniqueTimerLabel('search');
    console.time(searchLabel);

    const aggregated: SearchResponse = {
      object: 'list',
      type: 'page_or_data_source',
      page_or_data_source: {},
      results: [],
      next_cursor: null,
      has_more: false,
    };

    let cursor: string | undefined;
    for (let page = 0; page < SEARCH_MAX_PAGES; page++) {
      const response = await fetchPageOrStopOnCursorInvalidation(
        () =>
          withRetry(
            () =>
              this.notion.search({
                page_size: DEFAULT_PAGE_SIZE_LIMIT,
                query,
                sort: {
                  direction: 'descending',
                  timestamp: 'last_edited_time',
                },
                ...(cursor ? { start_cursor: cursor } : {}),
              }),
            { label: 'search' }
          ),
        cursor != null,
        'search'
      );
      if (response == null) {
        break;
      }

      aggregated.results.push(...response.results);

      if (!response.has_more || response.next_cursor == null) {
        break;
      }
      cursor = response.next_cursor;
    }

    console.timeEnd(searchLabel);
    return collapseDataSourcesToDatabases(aggregated);
  }

  static GetClientID(): string {
    return process.env.NOTION_CLIENT_ID!;
  }

  async getTopLevelTags(
    pageId: string,
    rules: ParserRules,
    createdAt: string,
    lastEditedAt: string
  ) {
    if (rules.TAGS === 'heading') {
      return [];
    }
    const response = await this.getBlocks({
      createdAt,
      lastEditedAt,
      id: pageId,
      all: true,
      type: 'page',
    });
    const globalTags = [];
    const paragraphs = getParagraphBlocks(response.results);
    for (const p of paragraphs) {
      const pp = p.paragraph;

      if (!pp) {
        continue;
      }

      const tt = pp.rich_text;
      if (!tt || tt.length < 1) {
        continue;
      }

      const { annotations } = tt[0];
      if (annotations.strikethrough) {
        globalTags.push(tt[0].plain_text);
      }
    }
    return sanitizeTags(globalTags);
  }

  getBlockTitle(icon: string | null, title: string, settings: CardOption) {
    if (!icon) {
      return title;
    }

    // the order here matters due to icon not being set and last not being default
    return settings.pageEmoji !== 'last_emoji'
      ? `${icon}${title}`
      : `${title}${icon}`;
  }

  async getPageTitle(
    page: GetPageResponse | null,
    settings: CardOption
  ): Promise<string> {
    if (!page) {
      return '';
    }
    let title = getNotionObjectTitle(page, { emoji: false }) ?? 'Untitled';
    let icon = await renderIcon(
      getBlockIcon(page as WithIcon, settings.pageEmoji)
    );
    return this.getBlockTitle(icon, title, settings);
  }

  async getDatabaseTitle(
    database: GetDatabaseResponse,
    settings: CardOption
  ): Promise<string> {
    let icon = await renderIcon(
      getBlockIcon(database as WithIcon, settings.pageEmoji)
    );
    let title = isFullDatabase(database)
      ? database.title.map((t) => t.plain_text).join('')
      : '';
    return this.getBlockTitle(icon, title, settings);
  }
}

export default NotionAPIWrapper;

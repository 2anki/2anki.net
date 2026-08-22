import { Client as NotionClient } from '@notionhq/client';
import { withRetry } from '../NotionService/helpers/withRetry';

export const notionBlockChildrenFetcherFactory = (token: string) => {
  const notion = new NotionClient({ auth: token });
  return async (blockId: string) => {
    const aggregated: unknown[] = [];
    let cursor: string | undefined;
    do {
      const startCursor = cursor;
      const response = await withRetry(
        () =>
          notion.blocks.children.list({
            block_id: blockId,
            page_size: 100,
            ...(startCursor == null ? {} : { start_cursor: startCursor }),
          }),
        { label: 'ankify:blocks.children.list' }
      );
      aggregated.push(...response.results);
      cursor = response.next_cursor ?? undefined;
    } while (cursor != null);
    return aggregated as never;
  };
};

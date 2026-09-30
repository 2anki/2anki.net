import { ColumnBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { IBlockRenderer } from '../BlockHandler/types';

export default async function getColumns(
  parentId: string,
  handler: IBlockRenderer
): Promise<ColumnBlockObjectResponse[]> {
  const response = await handler.api.getBlocks({
    createdAt: '',
    lastEditedAt: '',
    id: parentId,
    type: 'column_list',
  });
  return (response?.results ?? []) as ColumnBlockObjectResponse[];
}

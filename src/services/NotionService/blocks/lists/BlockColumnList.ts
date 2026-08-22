import { ColumnListBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { IBlockRenderer } from '../../BlockHandler/types';
import getChildren from '../../helpers/getChildren';
import getColumn from '../../helpers/getColumn';
import BlockColumn from './BlockColumn';

export default async function BlockColumnList(
  block: ColumnListBlockObjectResponse,
  handler: IBlockRenderer
) {
  const firstColumn = await getColumn(block.id, handler, 0);
  if (firstColumn) {
    return BlockColumn(firstColumn, handler);
  }
  return getChildren(block, handler);
}

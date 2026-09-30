import { ColumnListBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { IBlockRenderer } from '../../BlockHandler/types';
import getChildren from '../../helpers/getChildren';

export default async function BlockColumnList(
  block: ColumnListBlockObjectResponse,
  handler: IBlockRenderer
) {
  return getChildren(block, handler);
}

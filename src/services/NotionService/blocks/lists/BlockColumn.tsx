import { ColumnBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { IBlockRenderer } from '../../BlockHandler/types';
import getChildren from '../../helpers/getChildren';

export default function BlockColumn(
  block: ColumnBlockObjectResponse,
  handler: IBlockRenderer
) {
  return getChildren(block, handler);
}

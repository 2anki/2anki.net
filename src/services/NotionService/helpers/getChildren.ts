import { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';

import type { IBlockRenderer } from '../BlockHandler/types';

export default async function getChildren(
  block: BlockObjectResponse,
  handler: IBlockRenderer
): Promise<string> {
  let backSide = '';
  if (block.has_children) {
    backSide += await handler.getBackSide(block, true);
  }
  return backSide;
}

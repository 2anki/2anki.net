import { isFullBlock } from '@notionhq/client';
import {
  BlockObjectResponse,
  ListBlockChildrenResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import type { IBlockRenderer } from '../BlockHandler/types';
import { blockToStaticMarkup } from './blockToStaticMarkup';

export const renderBack = async (
  handler: IBlockRenderer,
  requestChildren: Array<PartialBlockObjectResponse | BlockObjectResponse>,
  response: ListBlockChildrenResponse,
  handleChildren: boolean | undefined
) => {
  let back = '';
  for (const c of requestChildren) {
    // If the block has been handled before, skip it.
    // This can be true due to nesting
    if (handler.skip.includes(c.id)) {
      continue;
    }

    if (!isFullBlock(c)) {
      continue;
    }
    back += await blockToStaticMarkup(handler, c, response);

    // Nesting applies to all not just toggles.
    // Callouts render their own children inside the figure, so the
    // re-recursion here would otherwise append them flat after the box.
    if (
      handleChildren ||
      (c.has_children &&
        c.type !== 'toggle' &&
        c.type !== 'bulleted_list_item' &&
        c.type !== 'callout')
    ) {
      back += await handler.getBackSide(c);
    }
  }
  return back;
};

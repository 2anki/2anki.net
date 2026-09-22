import { isFullBlock } from '@notionhq/client';
import {
  BlockObjectResponse,
  ListBlockChildrenResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import type { IBlockRenderer } from '../BlockHandler/types';
import { blockToStaticMarkup } from './blockToStaticMarkup';

export const MISSING_MEDIA_PLACEHOLDER =
  '<aside class="notion-media-unavailable">This embedded media couldn\'t be loaded.</aside>';

type BackChild = PartialBlockObjectResponse | BlockObjectResponse;

const TYPES_THAT_RENDER_OWN_CHILDREN = new Set([
  'toggle',
  'bulleted_list_item',
  'callout',
]);

const shouldRecurseIntoChildren = (
  block: BlockObjectResponse,
  handleChildren: boolean | undefined
): boolean =>
  Boolean(handleChildren) ||
  (block.has_children && !TYPES_THAT_RENDER_OWN_CHILDREN.has(block.type));

const renderBackChild = async (
  handler: IBlockRenderer,
  block: BlockObjectResponse,
  response: ListBlockChildrenResponse,
  handleChildren: boolean | undefined
): Promise<string> => {
  let markup = await blockToStaticMarkup(handler, block, response);
  if (shouldRecurseIntoChildren(block, handleChildren)) {
    markup += await handler.getBackSide(block);
  }
  return markup;
};

export const renderBack = async (
  handler: IBlockRenderer,
  requestChildren: BackChild[],
  response: ListBlockChildrenResponse,
  handleChildren: boolean | undefined
) => {
  let back = '';
  for (const c of requestChildren) {
    if (handler.skip.includes(c.id) || !isFullBlock(c)) {
      continue;
    }
    back += await renderBackChild(handler, c, response, handleChildren);
  }
  return back;
};

export const renderBackResilient = async (
  handler: IBlockRenderer,
  requestChildren: BackChild[],
  response: ListBlockChildrenResponse,
  handleChildren: boolean | undefined
) => {
  let back = '';
  for (const c of requestChildren) {
    if (handler.skip.includes(c.id) || !isFullBlock(c)) {
      continue;
    }
    try {
      back += await renderBackChild(handler, c, response, handleChildren);
    } catch (error) {
      console.warn(
        `Skipping unrenderable Notion block ${c.id} on the card back`,
        error
      );
      back += MISSING_MEDIA_PLACEHOLDER;
    }
  }
  return back;
};

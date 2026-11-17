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

// A type belongs here when its blockToStaticMarkup case already walks its own
// children through getChildren. Leaving one out makes renderBackChild render
// that subtree a second time.
const TYPES_THAT_RENDER_OWN_CHILDREN = new Set([
  'toggle',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'callout',
  'column_list',
]);

// The set is checked first on purpose. Every type in it reaches its children
// through getChildren, which calls getBackSide with handleChildren set, so
// testing that flag first would skip the set on the one path it exists for.
const shouldRecurseIntoChildren = (
  block: BlockObjectResponse,
  handleChildren: boolean | undefined
): boolean =>
  !TYPES_THAT_RENDER_OWN_CHILDREN.has(block.type) &&
  (Boolean(handleChildren) || block.has_children);

const renderBackChild = async (
  handler: IBlockRenderer,
  block: BlockObjectResponse,
  response: ListBlockChildrenResponse,
  handleChildren: boolean | undefined,
  groupedListItems: Set<string>
): Promise<string> => {
  let markup = await blockToStaticMarkup(
    handler,
    block,
    response,
    groupedListItems
  );
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
  const groupedListItems = new Set<string>();
  for (const c of requestChildren) {
    if (groupedListItems.has(c.id) || !isFullBlock(c)) {
      continue;
    }
    back += await renderBackChild(
      handler,
      c,
      response,
      handleChildren,
      groupedListItems
    );
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
  const groupedListItems = new Set<string>();
  for (const c of requestChildren) {
    if (groupedListItems.has(c.id) || !isFullBlock(c)) {
      continue;
    }
    try {
      back += await renderBackChild(
        handler,
        c,
        response,
        handleChildren,
        groupedListItems
      );
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

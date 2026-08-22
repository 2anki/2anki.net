import { ChildPageBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { IBlockRenderer } from '../BlockHandler/types';
import getBlockIcon, { WithIcon } from './getBlockIcon';
import renderLink from '../helpers/renderLink';

export const BlockChildPage = async (
  block: ChildPageBlockObjectResponse,
  handler: IBlockRenderer
) => {
  const childPage = block.child_page;
  const { api } = handler;
  const page = await api.getPage(block.id);
  const icon = getBlockIcon(page as WithIcon);

  if (handler.settings?.isTextOnlyBack && childPage) {
    return childPage.title;
  }

  return renderLink(childPage.title, block, icon);
};

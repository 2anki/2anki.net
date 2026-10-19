import { LinkToPageBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { IBlockRenderer } from '../../BlockHandler/types';
import type CardOption from '../../../../lib/parser/Settings';
import renderLink from '../../helpers/renderLink';
import getBlockIcon, { WithIcon } from '../getBlockIcon';

// The numbering strip only renames decks. A link_to_page renders the linked
// page title as inline card text, so it must keep its leading number even when
// the option is on.
function linkTextSettings(handler: IBlockRenderer): CardOption {
  const settings: CardOption = Object.assign(
    Object.create(Object.getPrototypeOf(handler.settings)),
    handler.settings
  );
  (settings as { removeDeckNameNumbering: boolean }).removeDeckNameNumbering =
    false;
  return settings;
}

export default async function LinkToPage(
  block: LinkToPageBlockObjectResponse,
  handler: IBlockRenderer
) {
  const linkToPage =
    block.link_to_page.type === 'page_id'
      ? block.link_to_page.page_id
      : undefined;
  if (!linkToPage) {
    return `Unsupported link ${JSON.stringify(block)}`;
  }
  const page = await handler.api.getPage(linkToPage);
  const title = await handler.api.getPageTitle(page, linkTextSettings(handler));
  return renderLink(title, block, getBlockIcon(page as WithIcon));
}

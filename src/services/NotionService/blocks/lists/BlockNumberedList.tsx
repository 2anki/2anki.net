import {
  ListBlockChildrenResponse,
  NumberedListItemBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import { convert } from 'html-to-text';
import type { IBlockRenderer } from '../../BlockHandler/types';
import getListItems from '../../helpers/getListItems';
import { styleWithColors } from '../../NotionColors';

export const BlockNumberedList = async (
  block: NumberedListItemBlockObjectResponse,
  response: ListBlockChildrenResponse | undefined,
  handler: IBlockRenderer
) => {
  const list = block.numbered_list_item;
  const items = await getListItems(response, handler, 'numbered_list_item');
  const listItems = items.filter(Boolean);
  const markup = ReactDOMServer.renderToStaticMarkup(
    <ol id={block.id} className={`numbered-list${styleWithColors(list.color)}`}>
      {listItems}
    </ol>
  );
  if (handler.settings?.isTextOnlyBack) {
    return convert(markup);
  }
  return markup;
};

import {
  ListBlockChildrenResponse,
  NumberedListItemBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import type { IBlockRenderer } from '../../BlockHandler/types';
import convertTextOnlyBack from '../../helpers/convertTextOnlyBack';
import getListItems from '../../helpers/getListItems';
import { styleWithColors } from '../../NotionColors';

export const BlockNumberedList = async (
  block: NumberedListItemBlockObjectResponse,
  response: ListBlockChildrenResponse | undefined,
  handler: IBlockRenderer,
  groupedListItems: Set<string>
) => {
  const list = block.numbered_list_item;
  const items = await getListItems(
    response,
    handler,
    'numbered_list_item',
    block,
    groupedListItems
  );
  const listItems = items.filter(Boolean);
  const markup = ReactDOMServer.renderToStaticMarkup(
    <ol id={block.id} className={`numbered-list${styleWithColors(list.color)}`}>
      {listItems}
    </ol>
  );
  if (handler.settings?.isTextOnlyBack) {
    return convertTextOnlyBack(markup);
  }
  return markup;
};

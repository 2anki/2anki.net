import { ParagraphBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import type { IBlockRenderer } from '../BlockHandler/types';

import convertTextOnlyBack from '../helpers/convertTextOnlyBack';
import renderTextChildren from '../helpers/renderTextChildren';
import { styleWithColors } from '../NotionColors';

const BlockParagraph = (
  block: ParagraphBlockObjectResponse,
  handler: IBlockRenderer
): string | null => {
  const { paragraph } = block;
  const { rich_text: richText } = paragraph;

  const markup = ReactDOMServer.renderToStaticMarkup(
    <p
      className={styleWithColors(paragraph.color)}
      id={block.id}
      dangerouslySetInnerHTML={{
        __html: renderTextChildren(
          richText,
          handler.settings,
          handler.tagRegistry
        ),
      }}
    ></p>
  );

  if (handler.settings?.isTextOnlyBack) {
    return convertTextOnlyBack(markup);
  }

  return markup;
};

export default BlockParagraph;

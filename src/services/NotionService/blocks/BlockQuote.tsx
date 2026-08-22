import { QuoteBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import type { IBlockRenderer } from '../BlockHandler/types';
import getPlainText from '../helpers/getPlainText';
import HandleBlockAnnotations from './HandleBlockAnnotations';
import { styleWithColors } from '../NotionColors';

export const BlockQuote = (
  block: QuoteBlockObjectResponse,
  handler: IBlockRenderer
) => {
  const { quote } = block;
  const { rich_text: richText } = quote;

  if (handler.settings?.isTextOnlyBack) {
    return getPlainText(richText);
  }

  return ReactDOMServer.renderToStaticMarkup(
    <blockquote className={styleWithColors(quote.color)} id={block.id}>
      {richText.map((t) => {
        const { annotations } = t;
        return HandleBlockAnnotations(annotations, t, {
          tagRegistry: handler.tagRegistry,
        });
      })}
    </blockquote>
  );
};

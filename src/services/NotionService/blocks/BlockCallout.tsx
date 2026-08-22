import {
  CalloutBlockObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import type { IBlockRenderer } from '../BlockHandler/types';
import getChildren from '../helpers/getChildren';
import getPlainText from '../helpers/getPlainText';
import { styleWithColors } from '../NotionColors';
import HandleBlockAnnotations from './HandleBlockAnnotations';

export const BlockCallout = async (
  block: CalloutBlockObjectResponse,
  handler: IBlockRenderer
) => {
  const { callout } = block;
  const { icon } = callout;
  const { rich_text: richText } = callout;

  if (handler.settings?.isTextOnlyBack) {
    return getPlainText(richText);
  }

  const childrenHtml = await getChildren(block, handler);

  const figureWithoutChildren = ReactDOMServer.renderToStaticMarkup(
    <figure
      id={block.id}
      className={`callout${styleWithColors(callout.color)}`}
      style={{ whiteSpace: 'pre-wrap', display: 'flex' }}
    >
      <div>
        {icon && icon.type === 'emoji' && (
          <span className="icon">{icon.emoji}</span>
        )}
      </div>
      <div style={{ width: '100%' }}>
        {richText.map((t: RichTextItemResponse) => {
          const { annotations } = t;
          return HandleBlockAnnotations(annotations, t, {
            noUnderline: handler.settings?.noUnderline,
            tagRegistry: handler.tagRegistry,
          });
        })}
      </div>
    </figure>
  );

  if (!childrenHtml) {
    return figureWithoutChildren;
  }

  return figureWithoutChildren.replace(
    '</div></figure>',
    `${childrenHtml}</div></figure>`
  );
};

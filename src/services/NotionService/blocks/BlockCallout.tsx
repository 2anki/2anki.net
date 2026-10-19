import {
  CalloutBlockObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import type { IBlockRenderer } from '../BlockHandler/types';
import type CardOption from '../../../lib/parser/Settings/CardOption';
import getChildren from '../helpers/getChildren';
import { toPlainTextBack } from '../../../lib/parser/toPlainTextBack';
import { styleWithColors } from '../NotionColors';
import HandleBlockAnnotations from './HandleBlockAnnotations';

const renderOwnText = (
  richText: RichTextItemResponse[],
  handler: IBlockRenderer
) =>
  ReactDOMServer.renderToStaticMarkup(
    <>
      {richText.map((t: RichTextItemResponse) => {
        const { annotations } = t;
        return HandleBlockAnnotations(annotations, t, {
          noUnderline: handler.settings?.noUnderline,
          tagRegistry: handler.tagRegistry,
        });
      })}
    </>
  );

const renderChildrenAsHtmlWithoutMedia = async (
  block: CalloutBlockObjectResponse,
  handler: IBlockRenderer
): Promise<string> => {
  if (!block.has_children) {
    return '';
  }
  const restore = {
    settings: handler.settings,
    embedImage: handler.embedImage,
    embedAudioFile: handler.embedAudioFile,
    embedFile: handler.embedFile,
  };
  const dropMedia = async () => '';
  handler.settings = Object.create(handler.settings, {
    isTextOnlyBack: { value: false, enumerable: true },
  }) as CardOption;
  handler.embedImage = dropMedia;
  handler.embedAudioFile = dropMedia;
  handler.embedFile = dropMedia;
  try {
    return (await handler.getBackSide(block, true)) ?? '';
  } finally {
    Object.assign(handler, restore);
  }
};

export const BlockCallout = async (
  block: CalloutBlockObjectResponse,
  handler: IBlockRenderer
) => {
  const { callout } = block;
  const { icon } = callout;
  const { rich_text: richText } = callout;

  if (handler.settings?.isTextOnlyBack) {
    const childrenHtml = await renderChildrenAsHtmlWithoutMedia(block, handler);
    return toPlainTextBack(
      `${renderOwnText(richText, handler)}${childrenHtml}`
    );
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

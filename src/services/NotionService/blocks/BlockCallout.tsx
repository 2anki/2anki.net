import {
  CalloutBlockObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import type { IBlockRenderer } from '../BlockHandler/types';
import getChildren from '../helpers/getChildren';
import { toPlainTextBack } from '../../../lib/parser/toPlainTextBack';
import { styleWithColors } from '../NotionColors';
import HandleBlockAnnotations from './HandleBlockAnnotations';

const dropMedia = async (): Promise<string> => '';

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
  const plainTextHandler = Object.create(handler, {
    settings: {
      value: Object.create(handler.settings, {
        isTextOnlyBack: { value: false, enumerable: true },
      }),
      enumerable: true,
    },
    embedImage: { value: dropMedia, enumerable: true },
    embedAudioFile: { value: dropMedia, enumerable: true },
    embedVideoFile: { value: dropMedia, enumerable: true },
    embedFile: { value: dropMedia, enumerable: true },
  }) as IBlockRenderer;
  return (await plainTextHandler.getBackSide(block, true)) ?? '';
};

const renderCalloutIcon = (
  icon: CalloutBlockObjectResponse['callout']['icon']
) => {
  if (icon?.type === 'emoji') {
    return <span className="icon">{icon.emoji}</span>;
  }
  if (icon?.type === 'custom_emoji') {
    return <img className="icon" src={icon.custom_emoji.url} alt="" />;
  }
  if (icon?.type === 'external') {
    return <img className="icon" src={icon.external.url} alt="" />;
  }
  return null;
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
      <div>{renderCalloutIcon(icon)}</div>
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

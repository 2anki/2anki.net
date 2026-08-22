import {
  BlockObjectResponse,
  GetBlockResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import type { IBlockRenderer } from '../BlockHandler/types';
import getPlainText from '../helpers/getPlainText';
import HandleBlockAnnotations from './HandleBlockAnnotations';
import { getHeadingText } from '../helpers/getHeadingText';
import { getHeadingColor } from '../helpers/getHeadingColor';
import { styleWithColors } from '../NotionColors';

interface HeadingProps {
  id: string;
  level: string;
  className: string;
  children: React.ReactNode;
}

const Heading = (props: HeadingProps) => {
  const { id, level, children, className } = props;
  switch (level) {
    case 'heading_3':
    case 'heading_4':
      return (
        <h3 id={id} className={className}>
          {children}
        </h3>
      );
    case 'heading_2':
      return (
        <h2 id={id} className={className}>
          {children}
        </h2>
      );
    default:
      return (
        <h1 id={id} className={className}>
          {children}
        </h1>
      );
  }
};

export const BlockHeading = (
  level: 'heading_1' | 'heading_2' | 'heading_3' | 'heading_4',
  block: GetBlockResponse,
  handler: IBlockRenderer
) => {
  const headingText = getHeadingText(block as BlockObjectResponse);
  if (!headingText) {
    return null;
  }

  if (handler.settings?.isTextOnlyBack) {
    return getPlainText(headingText);
  }

  return ReactDOMServer.renderToStaticMarkup(
    <Heading
      level={level}
      className={styleWithColors(getHeadingColor(block as BlockObjectResponse))}
      id={block.id}
    >
      {headingText.map((t: RichTextItemResponse) => {
        const { annotations } = t;
        return HandleBlockAnnotations(annotations, t, {
          tagRegistry: handler.tagRegistry,
        });
      })}
    </Heading>
  );
};

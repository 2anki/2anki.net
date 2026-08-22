import { ToggleBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import { convert } from 'html-to-text';

import type { IBlockRenderer } from '../../BlockHandler/types';
import renderTextChildren from '../../helpers/renderTextChildren';
import getChildren from '../../helpers/getChildren';
import { ReactNode } from 'react';
import { styleWithColors } from '../../NotionColors';

interface DetailsProps {
  children: ReactNode;
}

export async function BlockToggleList(
  block: ToggleBlockObjectResponse,
  handler: IBlockRenderer
) {
  const list = block.toggle;
  const { rich_text: richText } = list;
  const backSide = await getChildren(block, handler);
  /**
   * We can't just set open to false that won't work since it's a boolean and will be truthy.
   * The open attribute has to be omitted.
   */
  const Details = ({ children }: DetailsProps) =>
    handler.settings?.toggleMode === 'open_toggle' ? (
      <details open>{children}</details>
    ) : (
      <details>{children}</details>
    );

  const markup = ReactDOMServer.renderToStaticMarkup(
    <>
      <ul id={block.id} className={`toggle${styleWithColors(list.color)}`}>
        <li>
          <Details>
            <summary
              dangerouslySetInnerHTML={{
                __html: renderTextChildren(
                  richText,
                  handler.settings,
                  handler.tagRegistry
                ),
              }}
            ></summary>
            <div dangerouslySetInnerHTML={{ __html: backSide }} />
          </Details>
        </li>
      </ul>
    </>
  );

  if (handler.settings?.isTextOnlyBack) {
    return convert(markup);
  }

  return markup;
}

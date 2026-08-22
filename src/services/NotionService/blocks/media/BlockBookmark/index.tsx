import ReactDOMServer from 'react-dom/server';
import { convert } from 'html-to-text';

import { BookmarkBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import useMetadata from './hooks/useMetadata';
import type { IBlockRenderer } from '../../../BlockHandler/types';
import React from 'react';
import { BookmarkTitle } from './components/BookmarkTitle';
import { BookmarkDescription } from './components/BookmarkDescription';
import { BookmarkLogo } from './components/BookmarkLogo';
import { BookmarkImage } from './components/BookmarkImage';
import { BookmarkContainer } from './components/BookmarkContainer';

const BlockBookmark = async (
  block: BookmarkBlockObjectResponse,
  handler: IBlockRenderer
): Promise<string | null> => {
  const { bookmark } = block;
  const metadata = await useMetadata(bookmark.url);

  if (handler.settings?.isTextOnlyBack && bookmark) {
    return `${metadata.title} ${bookmark.url}`;
  }

  const markup = ReactDOMServer.renderToStaticMarkup(
    <BookmarkContainer url={bookmark.url}>
      <div className="bookmark-info">
        <div className="bookmark-text">
          <BookmarkTitle title={metadata.title} />
          <BookmarkDescription description={metadata.description} />
        </div>
        <div className="bookmark-href">
          <BookmarkLogo logo={metadata.logo} />
          {bookmark.url}
        </div>
      </div>
      <BookmarkImage image={metadata.image} />
    </BookmarkContainer>
  );

  if (handler.settings?.isTextOnlyBack) {
    return convert(markup);
  }

  return markup;
};

export default BlockBookmark;

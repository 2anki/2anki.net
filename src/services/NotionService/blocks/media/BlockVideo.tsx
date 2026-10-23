import { VideoBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IBlockRenderer } from '../../BlockHandler/types';
import { getVideoUrl } from './helpers/getVideoUrl';
import { isVimeoLink } from './helpers/isVimeoLink';

export const BlockVideo = async (
  c: VideoBlockObjectResponse,
  handler: IBlockRenderer
) => {
  if (c.video.type === 'file') {
    return handler.embedVideoFile(c);
  }
  const url = getVideoUrl(c);
  if (handler.settings?.isTextOnlyBack || !url) {
    return null;
  }
  if (isVimeoLink(url)) {
    return url;
  }

  return renderToStaticMarkup(
    <>
      <iframe
        width="560"
        height="315"
        src={url}
        frameBorder="0"
        allowFullScreen
      ></iframe>
    </>
  );
};

import { GetBlockResponse } from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import BlockHandler from '../BlockHandler';
import getPlainText from '../helpers/getPlainText';
import { styleWithColors } from '../NotionColors';
import HandleBlockAnnotations from './HandleBlockAnnotations';

const BlockCode = (block: GetBlockResponse, handler: BlockHandler) => {
  /* @ts-ignore */
  const { code } = block;
  const { text } = code;

  if (handler.settings?.isTextOnlyBack) {
    return getPlainText(text);
  }

  return ReactDOMServer.renderToStaticMarkup(
    <pre id={block.id} className={`code code-wrap${styleWithColors(code.color)}`}>
      <code>
        {text.map((t: GetBlockResponse) => {
          /* @ts-ignore */
          const { annotations } = t;
          /* @ts-ignore */
          return HandleBlockAnnotations(annotations, t.text);
        })}
      </code>
    </pre>,
  );
};

export default BlockCode;

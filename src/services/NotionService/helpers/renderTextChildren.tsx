import {
  EquationRichTextItemResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import ReactDOMServer from 'react-dom/server';
import CardOption from '../../../lib/parser/Settings';
import TagRegistry from '../../../lib/parser/TagRegistry';

import { renderInlineEquation } from '../blocks/BlockEquation';
import HandleBlockAnnotations from '../blocks/HandleBlockAnnotations';
import isEquation from './isEquation';
import isMention from './isMention';
import isText from './isText';
import preserveNewlinesIfApplicable from './preserveNewlinesIfApplicable';

export default function renderTextChildren(
  text: RichTextItemResponse[] | undefined,
  settings: CardOption,
  tagRegistry?: TagRegistry
): string {
  if (!text || text?.length === 0) {
    return '';
  }
  const content = text
    .map((t: RichTextItemResponse) => {
      if (isEquation(t)) {
        const rendered = renderInlineEquation(
          t as EquationRichTextItemResponse
        );
        return t.annotations.code ? `<code>${rendered}</code>` : rendered;
      }

      if (isText(t) || isMention(t)) {
        return ReactDOMServer.renderToStaticMarkup(
          <>
            {HandleBlockAnnotations(t.annotations, t, {
              noUnderline: settings.noUnderline,
              tagRegistry,
            })}
          </>
        );
      }

      return `unsupported type: ${t.type}\n${JSON.stringify(t, null, 2)}`;
    })
    .reduce((acc, curr) => acc + curr);
  return preserveNewlinesIfApplicable(content, settings);
}

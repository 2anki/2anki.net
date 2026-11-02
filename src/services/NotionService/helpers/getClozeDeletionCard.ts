import {
  EquationRichTextItemResponse,
  GetBlockResponse,
  TextRichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';

import Note from '../../../lib/parser/Note';
import type TagRegistry from '../../../lib/parser/TagRegistry';
import { escapeHtml } from '../../../lib/notion-render/escape';
import { renderInlineEquation } from '../blocks/BlockEquation';
import { getRichTextFromBlock } from './getRichTextFromBlock';
import isColumnList from './isColumnList';
import isEquation from './isEquation';

// The user wants to turn code blocks into cloze deletions <code>word</code> becomes {{c1::word}}
// This all should be tested with Jest
export default function getClozeDeletionCard(
  block: GetBlockResponse,
  tagRegistry?: TagRegistry
): Note | undefined {
  let isCloze = false;
  let name = '';
  let index = 1;

  const richText = getRichTextFromBlock(block);
  if (!richText || isColumnList(block)) {
    return undefined;
  }
  for (const cb of richText) {
    if (isEquation(cb)) {
      const rendered = escapeHtml(
        renderInlineEquation(cb as EquationRichTextItemResponse)
      );
      if (cb.annotations.code) {
        name += `{{c${index}::${rendered}}}`;
        isCloze = true;
        index++;
      } else {
        name += rendered;
      }
      continue;
    }
    if (cb.annotations.strikethrough && tagRegistry?.collects()) {
      continue;
    }
    const raw = (cb as TextRichTextItemResponse).text?.content;
    const content = raw == null ? undefined : escapeHtml(raw);
    if (cb.annotations.code) {
      if (content?.includes('::')) {
        if (content.match(/[cC]\d+::/)) {
          name += `{{${content}}}`;
        } else {
          const clozeIndex = `{{c${index}::`;
          if (!name.includes(clozeIndex)) {
            name += `{{c${index}::${content}}}`;
          }
        }
      } else {
        name += `{{c${index}::${content}}}`;
      }
      name = name.replace('{{{{', '{{').replace('}}}}', '}}');
      isCloze = true;
      index++;
    } else if (content) {
      name += content;
    }
  }
  if (isCloze) {
    const note = new Note(name, '');
    note.cloze = isCloze;
    return note;
  }
  return undefined;
}

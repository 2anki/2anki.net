import {
  EquationRichTextItemResponse,
  GetBlockResponse,
  TextRichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { escapeHtml } from '../../../lib/notion-render/escape';
import ParserRules from '../../../lib/parser/ParserRules';
import Note from '../../../lib/parser/Note';
import type TagRegistry from '../../../lib/parser/TagRegistry';
import { renderInlineEquation } from '../blocks/BlockEquation';
import isColumnList from './isColumnList';
import isEquation from './isEquation';
import { getRichTextFromBlock } from './getRichTextFromBlock';

// The user wants to turn under lines into input cards <strong>keyword</strong> becomes {{type::word}}
export default function getInputCard(
  rules: ParserRules,
  block: GetBlockResponse,
  tagRegistry?: TagRegistry
): Note | undefined {
  let isInput = false;
  let name = '';
  let answer = '';
  const flashcardBlock = getRichTextFromBlock(block);
  if (!flashcardBlock || isColumnList(block)) {
    return undefined;
  }
  for (const cb of flashcardBlock) {
    if (cb.annotations.strikethrough && tagRegistry?.collects()) {
      continue;
    }
    const content = isEquation(cb)
      ? escapeHtml(renderInlineEquation(cb as EquationRichTextItemResponse))
      : escapeHtml(
          (cb as TextRichTextItemResponse).text?.content ?? cb.plain_text
        );
    if (cb.annotations.underline || cb.annotations.bold) {
      answer += content;
      isInput = true;
    } else {
      name += content;
    }
  }
  if (isInput) {
    const note = new Note(name, '');
    note.enableInput = isInput;
    note.answer = answer;
    return note;
  }
  return undefined;
}

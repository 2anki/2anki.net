import {
  GetBlockResponse,
  TextRichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';

import ParserRules from '../../../lib/parser/ParserRules';
import Note from '../../../lib/parser/Note';
import isColumnList from './isColumnList';
import { getRichTextFromBlock } from './getRichTextFromBlock';

// The user wants to turn under lines into input cards <strong>keyword</strong> becomes {{type::word}}
export default function getInputCard(
  rules: ParserRules,
  block: GetBlockResponse
): Note | undefined {
  let isInput = false;
  let name = '';
  let answer = '';
  const flashcardBlock = getRichTextFromBlock(block);
  if (!flashcardBlock || isColumnList(block)) {
    return undefined;
  }
  for (const cb of flashcardBlock) {
    const text = (cb as TextRichTextItemResponse).text;
    if (cb.annotations.underline || cb.annotations.bold) {
      answer += text?.content;
      isInput = true;
    } else {
      name += text?.content;
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

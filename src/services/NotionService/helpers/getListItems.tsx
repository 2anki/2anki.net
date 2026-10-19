import {
  BlockObjectResponse,
  ListBlockChildrenResponse,
  PartialBlockObjectResponse,
  ToDoBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

import renderTextChildren from './renderTextChildren';
import type { IBlockRenderer } from '../BlockHandler/types';
import getChildren from './getChildren';
import { getListBlock } from './getListBlock';
import { getListColor } from './getListColor';
import { getRichTextFromBlock } from './getRichTextFromBlock';
import { styleWithColors } from '../NotionColors';

type ListType = 'numbered_list_item' | 'bulleted_list_item' | 'to_do';

type ListChild = PartialBlockObjectResponse | BlockObjectResponse;

function getConsecutiveRun(
  results: ListChild[],
  type: ListType,
  startBlock: BlockObjectResponse
): ListChild[] {
  const startIndex = results.findIndex((r) => r.id === startBlock.id);
  if (startIndex === -1) {
    return [startBlock];
  }
  const run: ListChild[] = [];
  for (let i = startIndex; i < results.length; i += 1) {
    const list = getListBlock(results[i]);
    if (!list || list.type !== type) {
      break;
    }
    run.push(results[i]);
  }
  return run;
}

export default function getListItems(
  response: ListBlockChildrenResponse | undefined,
  handler: IBlockRenderer,
  type: ListType,
  startBlock: BlockObjectResponse
) {
  if (!response) {
    return [];
  }
  const run = getConsecutiveRun(response.results, type, startBlock);
  return Promise.all(
    run.map(async (result) => {
      const list = getListBlock(result);
      if (!list) {
        return null;
      }
      const backSide = await getChildren(list, handler);
      handler.skip.push(result.id);
      const todo =
        type === 'to_do' ? (list as ToDoBlockObjectResponse).to_do : null;
      const checked = todo?.checked
        ? 'to-do-children-checked'
        : 'to-do-children-unchecked';
      const checkedClass = todo ? checked : '';

      return (
        <li id={result.id} className={`${styleWithColors(getListColor(list))}`}>
          {todo && (
            <div
              className={`checkbox checkbox-${todo.checked ? 'on' : 'off'}`}
            ></div>
          )}
          <div
            dangerouslySetInnerHTML={{
              __html: renderTextChildren(
                getRichTextFromBlock(list),
                handler.settings,
                handler.tagRegistry
              ),
            }}
          />
          {backSide && (
            <div
              className={`${checkedClass}`}
              dangerouslySetInnerHTML={{ __html: backSide }}
            ></div>
          )}
        </li>
      );
    })
  );
}

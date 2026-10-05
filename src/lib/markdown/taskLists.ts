import type MarkdownIt from 'markdown-it';

type Token = MarkdownIt.Token;
type StateCore = MarkdownIt.StateCore;

const TODO_MARKER_RE = /^\[([ xX])\] /;
const CHECKED_MARKER_RE = /^\[[xX]\] /;
const UNCHECKED_INPUT =
  '<input class="task-list-item-checkbox" disabled="" type="checkbox">';
const CHECKED_INPUT =
  '<input class="task-list-item-checkbox" checked="" disabled="" type="checkbox">';

const isTaskItem = (tokens: Token[], index: number): boolean =>
  tokens[index].type === 'inline' &&
  tokens[index].children != null &&
  tokens[index - 1].type === 'paragraph_open' &&
  tokens[index - 2].type === 'list_item_open' &&
  TODO_MARKER_RE.test(tokens[index].content);

const listParentIndex = (tokens: Token[], itemOpenIndex: number): number => {
  const targetLevel = tokens[itemOpenIndex].level - 1;
  for (let i = itemOpenIndex - 1; i >= 0; i--) {
    if (tokens[i].level === targetLevel) {
      return i;
    }
  }
  return -1;
};

const todoify = (inline: Token, state: StateCore): void => {
  const children = inline.children;
  if (children == null) {
    return;
  }
  const checkbox = new state.Token('html_inline', '', 0);
  checkbox.content = CHECKED_MARKER_RE.test(inline.content)
    ? CHECKED_INPUT
    : UNCHECKED_INPUT;
  children.unshift(checkbox);
  children[1].content = children[1].content.slice(3);
  inline.content = inline.content.slice(3);
};

const taskListsPlugin = (md: MarkdownIt.MarkdownIt): void => {
  md.core.ruler.after('inline', 'task-lists', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      if (isTaskItem(tokens, i)) {
        todoify(tokens[i], state);
        tokens[i - 2].attrSet('class', 'task-list-item');
        const parent = listParentIndex(tokens, i - 2);
        if (parent >= 0) {
          tokens[parent].attrSet('class', 'contains-task-list');
        }
      }
    }
  });
};

export default taskListsPlugin;

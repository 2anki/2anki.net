import fs from 'fs';
import path from 'path';

import { NOTION_STYLE, getCodeThemeCss } from '../../templates/helper';
import { withFontSize } from './withFontSize';
import { withTextAlign } from './withTextAlign';
import { withTextColor } from './withTextColor';

// Notion's own export stylesheet (current palette for highlights, callouts and
// block colours), taken from a Notion HTML export with every
// `white-space: pre-wrap` and `list-style-type: none` removed: the first harms
// body and toggle text, the second breaks nested toggles.
const NOTION_EXPORT_STYLE = fs.readFileSync(
  path.join(__dirname, '../../templates/notion-export.css'),
  'utf8'
);

// Notion code blocks export as <pre class="code code-wrap"> and rely on
// pre-wrap to wrap long lines, so wrapping comes back for code only, last so
// it wins the cascade.
const CODE_WRAP_STYLE = '.code-wrap, pre { white-space: pre-wrap; }';

// Notion spaces every bullet the same, nested ones included. The list items
// export as <li><div>text</div><div><ul>…</ul></div></li>, so the nested list
// never matched the `li > ul` margin rule and sat tighter than its parent.
const LIST_SPACING_STYLE = [
  'li { margin-block: 0.25em; }',
  'li > div > ul, li > div > ol { margin-block: 0.25em 0; }',
].join('\n');

interface DeckStyleSettings {
  codeTheme: string;
  fontSize?: string;
  textColor?: string;
  textAlign?: string;
}

// Every 2anki deck of a note type shares one note type id, and Anki keeps the
// first CSS it sees for that id until NOTETYPE_MOD is bumped (#4447). So the
// CSS has to come from the settings alone, never from the file being
// converted, or a txt deck imported first leaves later Notion decks unstyled.
export function buildDeckStyle(settings: DeckStyleSettings): string {
  const base = [
    NOTION_STYLE,
    getCodeThemeCss(settings.codeTheme),
    NOTION_EXPORT_STYLE,
    CODE_WRAP_STYLE,
    LIST_SPACING_STYLE,
  ].join('\n');
  return (
    withTextAlign(
      withTextColor(withFontSize(base, settings.fontSize), settings.textColor),
      settings.textAlign
    ) ?? base
  );
}

export function withDeckStyle<T extends { style: string | null }>(
  decks: T[],
  settings: DeckStyleSettings
): T[] {
  const style = buildDeckStyle(settings);
  return decks.map((deck) => ({ ...deck, style }));
}

import {
  RichTextItemResponse,
  ToggleBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

import ParserRules from '../../../lib/parser/ParserRules';
import getInputCard from './getInputCard';

const baseAnnotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default' as const,
};

function makeText(
  content: string,
  annotations: Partial<typeof baseAnnotations> = {}
): RichTextItemResponse {
  return {
    type: 'text',
    text: { content, link: null },
    annotations: { ...baseAnnotations, ...annotations },
    plain_text: content,
    href: null,
  } as unknown as RichTextItemResponse;
}

function makeToggle(
  richText: RichTextItemResponse[]
): ToggleBlockObjectResponse {
  return {
    object: 'block',
    id: 'toggle-1',
    type: 'toggle',
    has_children: true,
    toggle: { rich_text: richText, color: 'default' },
  } as unknown as ToggleBlockObjectResponse;
}

describe('getInputCard', () => {
  it('escapes markup characters in the front and the typed answer', () => {
    const note = getInputCard(
      new ParserRules(),
      makeToggle([
        makeText('Is 3 < 4 & 5 > 2? '),
        makeText('<yes>', { bold: true }),
      ])
    );

    expect(note?.enableInput).toBe(true);
    expect(note?.name).toBe('Is 3 &lt; 4 &amp; 5 &gt; 2? ');
    expect(note?.answer).toBe('&lt;yes&gt;');
  });

  it('returns no card when nothing is bold or underlined', () => {
    const note = getInputCard(
      new ParserRules(),
      makeToggle([makeText('Plain question')])
    );

    expect(note).toBeUndefined();
  });
});

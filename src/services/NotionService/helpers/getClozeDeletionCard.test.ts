import {
  RichTextItemResponse,
  ToggleBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

import getClozeDeletionCard from './getClozeDeletionCard';

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

function makeEquation(
  expression: string,
  annotations: Partial<typeof baseAnnotations> = {}
): RichTextItemResponse {
  return {
    type: 'equation',
    equation: { expression },
    annotations: { ...baseAnnotations, ...annotations },
    plain_text: expression,
    href: null,
  } as unknown as RichTextItemResponse;
}

function makeToggle(
  richText: RichTextItemResponse[]
): ToggleBlockObjectResponse {
  return {
    object: 'block',
    id: 'toggle-1',
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '2026-07-30T00:00:00.000Z',
    last_edited_time: '2026-07-30T00:00:00.000Z',
    created_by: { object: 'user', id: 'user-1' },
    last_edited_by: { object: 'user', id: 'user-1' },
    has_children: true,
    archived: false,
    in_trash: false,
    type: 'toggle',
    toggle: { rich_text: richText, color: 'default' },
  } as unknown as ToggleBlockObjectResponse;
}

describe('getClozeDeletionCard — inline equations marked as code', () => {
  it('turns a coded equation into a cloze wrapping the rendered LaTeX, not undefined', () => {
    const note = getClozeDeletionCard(
      makeToggle([makeEquation('E = mc^2', { code: true })])
    );

    expect(note).toBeDefined();
    expect(note?.cloze).toBe(true);
    expect(note?.name).toBe('{{c1::\\(E = mc^2\\)}}');
    expect(note?.name).not.toContain('undefined');
  });

  it('keeps a non-coded equation in the cloze text when another run is coded', () => {
    const note = getClozeDeletionCard(
      makeToggle([
        makeText('The formula '),
        makeEquation('E = mc^2', { code: true }),
        makeText(' relates to '),
        makeEquation('\\pi'),
      ])
    );

    expect(note).toBeDefined();
    expect(note?.cloze).toBe(true);
    expect(note?.name).toContain('The formula ');
    expect(note?.name).toContain('{{c1::\\(E = mc^2\\)}}');
    expect(note?.name).toContain(' relates to ');
    expect(note?.name).toContain('\\(\\pi\\)');
  });

  it('never emits a triple closing brace when the LaTeX ends in a curly brace', () => {
    const note = getClozeDeletionCard(
      makeToggle([makeEquation('\\frac{1}{2}', { code: true })])
    );

    expect(note?.name).toBe('{{c1::\\(\\frac{1}{2}\\)}}');
    expect(note?.name.endsWith('\\)}}')).toBe(true);
    expect(note?.name).not.toContain('}}}');
  });
});

describe('getClozeDeletionCard — plain text is escaped', () => {
  it('escapes markup characters in the text and in the cloze answer', () => {
    const note = getClozeDeletionCard(
      makeToggle([
        makeText('If a < b then '),
        makeText('x & <y>', { code: true }),
      ])
    );

    expect(note?.name).toBe('If a &lt; b then {{c1::x &amp; &lt;y&gt;}}');
  });

  it('escapes an inline equation so a < in LaTeX is not read as a tag', () => {
    const note = getClozeDeletionCard(
      makeToggle([makeText('Solve '), makeEquation('a<b', { code: true })])
    );

    expect(note?.name).toBe('Solve {{c1::\\(a&lt;b\\)}}');
  });

  it('keeps an explicit cloze number while escaping its answer', () => {
    const note = getClozeDeletionCard(
      makeToggle([makeText('c2::Tom & Jerry', { code: true })])
    );

    expect(note?.name).toBe('{{c2::Tom &amp; Jerry}}');
  });
});

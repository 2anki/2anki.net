import { RichTextItemResponse } from '@notionhq/client/build/src/api-endpoints';
import renderTextChildren from './renderTextChildren';
import CardOption from '../../../lib/parser/Settings';
import TagRegistry from '../../../lib/parser/TagRegistry';

const baseAnnotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default' as string,
};

const defaultSettings = new CardOption(CardOption.LoadDefaultOptions());

function makeMention(
  plainText: string,
  annotations: Partial<typeof baseAnnotations> = {}
): RichTextItemResponse {
  return {
    type: 'mention',
    plain_text: plainText,
    href: null,
    annotations: { ...baseAnnotations, ...annotations },
    mention: {
      type: 'page',
      page: { id: 'some-page-id' },
    },
  } as unknown as RichTextItemResponse;
}

function makeText(
  plainText: string,
  annotations: Partial<typeof baseAnnotations> = {}
): RichTextItemResponse {
  return {
    type: 'text',
    plain_text: plainText,
    href: null,
    annotations: { ...baseAnnotations, ...annotations },
    text: { content: plainText, link: null },
  } as unknown as RichTextItemResponse;
}

function makeEquation(
  expression: string,
  annotations: Partial<typeof baseAnnotations> = {}
): RichTextItemResponse {
  return {
    type: 'equation',
    plain_text: expression,
    href: null,
    annotations: { ...baseAnnotations, ...annotations },
    equation: { expression },
  } as unknown as RichTextItemResponse;
}

describe('renderTextChildren — strikethrough tag collection', () => {
  it('records strikethrough text into the registry it is handed', () => {
    const registry = new TagRegistry();
    const items: RichTextItemResponse[] = [
      makeText('keep', { strikethrough: true }),
    ];

    renderTextChildren(items, defaultSettings, registry);

    expect(registry.strikethroughs).toEqual(['keep']);
  });

  it('keeps two conversions strikethroughs apart when run interleaved', () => {
    const conversionA = new TagRegistry();
    const conversionB = new TagRegistry();

    renderTextChildren(
      [makeText('a-tag', { strikethrough: true })],
      defaultSettings,
      conversionA
    );
    renderTextChildren(
      [makeText('b-tag', { strikethrough: true })],
      defaultSettings,
      conversionB
    );

    expect(conversionA.strikethroughs).toEqual(['a-tag']);
    expect(conversionB.strikethroughs).toEqual(['b-tag']);
  });

  it('leaves the registry empty when no text is struck through', () => {
    const registry = new TagRegistry();

    renderTextChildren([makeText('plain')], defaultSettings, registry);

    expect(registry.strikethroughs).toEqual([]);
  });
});

describe('renderTextChildren — inline equations', () => {
  it('renders an unannotated equation as bare Anki inline math', () => {
    const result = renderTextChildren(
      [makeEquation('E = mc^2')],
      defaultSettings
    );
    expect(result).toBe('\\(E = mc^2\\)');
    expect(result).not.toContain('<code>');
  });

  it('wraps a coded equation in a code element so the cloze pass can pick it up', () => {
    const result = renderTextChildren(
      [makeEquation('E = mc^2', { code: true })],
      defaultSettings
    );
    expect(result).toBe('<code>\\(E = mc^2\\)</code>');
  });
});

describe('renderTextChildren — mention support', () => {
  it('renders the plain_text of an annotated mention', () => {
    const items: RichTextItemResponse[] = [
      makeMention('Alexander', { bold: true }),
    ];
    const result = renderTextChildren(items, defaultSettings);
    expect(result).toContain('Alexander');
    expect(result).toContain('<strong>');
  });

  it('renders an unannotated mention as plain text', () => {
    const items: RichTextItemResponse[] = [makeMention('My Page')];
    const result = renderTextChildren(items, defaultSettings);
    expect(result).toContain('My Page');
    expect(result).not.toContain('unsupported type');
  });

  it('does not include a link for mention types', () => {
    const items: RichTextItemResponse[] = [makeMention('Linked Page')];
    const result = renderTextChildren(items, defaultSettings);
    expect(result).not.toContain('<a ');
  });
});

describe('renderTextChildren — inline colors', () => {
  it('renders red text with the Notion red, not default black', () => {
    const result = renderTextChildren(
      [makeText('wichtig', { color: 'red' })],
      defaultSettings
    );
    expect(result).toContain('color:#E03E3E');
    expect(result).toContain('wichtig');
  });

  it('renders a background highlight with the pale tint, not the text hex', () => {
    const result = renderTextChildren(
      [makeText('marked', { color: 'red_background' })],
      defaultSettings
    );
    expect(result).toContain('background-color:rgb(253, 235, 236)');
    expect(result).not.toContain('background-color:#E03E3E');
  });

  it('leaves default-colored text unwrapped', () => {
    const result = renderTextChildren([makeText('plain')], defaultSettings);
    expect(result).toBe('plain');
  });

  it('keeps color alongside bold', () => {
    const result = renderTextChildren(
      [makeText('both', { color: 'blue', bold: true })],
      defaultSettings
    );
    expect(result).toContain('color:#0B6E99');
    expect(result).toContain('<strong>');
  });
});

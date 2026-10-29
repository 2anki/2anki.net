import {
  GetBlockResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import {
  blocksPlainTextLength,
  induceNotesFromBlocks,
} from './induceNotesFromBlocks';
import CardOption from '../../../../lib/parser/Settings/CardOption';
import TagRegistry from '../../../../lib/parser/TagRegistry';

interface Annotation {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  color?: string;
}

function richText(content: string, annotation: Annotation = {}) {
  return {
    type: 'text' as const,
    text: { content, link: null },
    annotations: {
      bold: annotation.bold ?? false,
      italic: annotation.italic ?? false,
      strikethrough: annotation.strikethrough ?? false,
      underline: annotation.underline ?? false,
      code: annotation.code ?? false,
      color: annotation.color ?? ('default' as const),
    },
    plain_text: content,
    href: null,
  } as unknown as RichTextItemResponse;
}

let blockCounter = 0;

function block(
  type: string,
  richTextItems: RichTextItemResponse[]
): GetBlockResponse {
  blockCounter += 1;
  return {
    object: 'block',
    id: `${type}-${blockCounter}`,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type,
    [type]: { rich_text: richTextItems, color: 'default' },
  } as unknown as GetBlockResponse;
}

function dividerBlock(): GetBlockResponse {
  blockCounter += 1;
  return {
    object: 'block',
    id: `divider-${blockCounter}`,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'divider',
    divider: {},
  } as unknown as GetBlockResponse;
}

function settings(): CardOption {
  return new CardOption({});
}

describe('induceNotesFromBlocks', () => {
  it('pairs a heading with the content that follows it', () => {
    const blocks = [
      block('heading_2', [richText('What is spaced repetition?')]),
      block('paragraph', [richText('A method that spaces reviews over time.')]),
      block('heading_2', [richText('What is a flashcard?')]),
      block('paragraph', [richText('A prompt paired with an answer.')]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'heading',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(2);
    expect(notes[0].name).toContain('spaced repetition');
    expect(notes[0].back).toContain('spaces reviews');
    expect(notes[1].name).toContain('flashcard');
  });

  it('preserves bold and highlight annotations in the rescued card', () => {
    const blocks = [
      block('heading_2', [richText('Key term')]),
      block('paragraph', [
        richText('The '),
        richText('mitochondria', { bold: true }),
        richText(' is '),
        richText('highlighted', { color: 'yellow_background' }),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'heading',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].back).toContain('<strong>mitochondria</strong>');
    expect(notes[0].back).toContain('background-color');
  });

  it('drops a front with no following content so it never ships an empty back', () => {
    const blocks = [
      block('heading_2', [richText('Lonely heading')]),
      block('heading_2', [richText('Another lonely heading')]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'heading',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(0);
  });

  it('groups bullets with their following explanation', () => {
    const blocks = [
      block('bulleted_list_item', [richText('Osmosis')]),
      block('paragraph', [richText('Water moves across a membrane.')]),
      block('bulleted_list_item', [richText('Diffusion')]),
      block('paragraph', [richText('Particles spread from high to low.')]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'bullets',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(2);
    expect(notes[0].name).toContain('Osmosis');
    expect(notes[0].back).toContain('membrane');
  });

  it('returns nothing for a rule with no in-memory front blocks', () => {
    const blocks = [
      block('paragraph', [richText('Just prose, no structure.')]),
    ];
    expect(
      induceNotesFromBlocks(blocks, 'columns', settings(), new TagRegistry())
    ).toHaveLength(0);
  });

  it('measures the plain-text length of the in-memory blocks', () => {
    const blocks = [
      block('heading_2', [richText('abc')]),
      block('paragraph', [richText('defg')]),
    ];
    expect(blocksPlainTextLength(blocks)).toBe(7);
  });

  it('pairs an English Q:/A: shape and strips the markers', () => {
    const blocks = [
      block('paragraph', [richText('Q: What is diffusion?')]),
      block('paragraph', [richText('A: Movement from high to low.')]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'guess',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe('What is diffusion?');
    expect(notes[0].name).not.toContain('Q:');
    expect(notes[0].back).toBe('Movement from high to low.');
    expect(notes[0].back).not.toContain('A:');
  });

  it('pairs a German F:/A: shape and keeps a formatted answer intact', () => {
    const blocks = [
      block('paragraph', [richText('F: Was ist die Zellwand?')]),
      block('paragraph', [
        richText('A: Die '),
        richText('Zellwand', { bold: true }),
        richText(' schützt die '),
        richText('Zelle', { color: 'green_background' }),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'guess',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toContain('Zellwand');
    expect(notes[0].back).toContain('<strong>Zellwand</strong>');
    expect(notes[0].back).toContain('background-color');
  });

  it('splits a term::definition block while preserving bold in the definition', () => {
    const blocks = [
      block('paragraph', [
        richText('Osmosis::water crossing a '),
        richText('membrane', { bold: true }),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'guess',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe('Osmosis');
    expect(notes[0].back).toContain('<strong>membrane</strong>');
  });

  it('does not split a term::definition on the :: inside a cloze deletion', () => {
    const blocks = [
      block('paragraph', [
        richText('{{c1::Canberra::city}} was founded in 1913'),
      ]),
    ];

    expect(
      induceNotesFromBlocks(blocks, 'guess', settings(), new TagRegistry())
    ).toHaveLength(0);
  });

  it('does not treat an ordinary paragraph as a marker card', () => {
    const blocks = [
      block('paragraph', [richText('Photosynthesis converts light energy.')]),
      block('paragraph', [richText('Respiration releases stored energy.')]),
    ];

    expect(
      induceNotesFromBlocks(blocks, 'guess', settings(), new TagRegistry())
    ).toHaveLength(0);
  });

  it('does not pair MCQ option labels (Q. / A. / B.) as question and answer', () => {
    const blocks = [
      block('paragraph', [richText('Q. What is the capital of France?')]),
      block('paragraph', [richText('A. London')]),
      block('paragraph', [richText('B. Berlin')]),
      block('paragraph', [richText('C. Paris')]),
    ];

    expect(
      induceNotesFromBlocks(blocks, 'guess', settings(), new TagRegistry())
    ).toHaveLength(0);
  });

  it('pairs Q:/A: across a no-text block sitting between them', () => {
    const blocks = [
      block('paragraph', [richText('Q: What is diffusion?')]),
      dividerBlock(),
      block('paragraph', [richText('A: Movement from high to low.')]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'guess',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe('What is diffusion?');
    expect(notes[0].back).toBe('Movement from high to low.');
  });

  it('rescues heading_1 sections the deleted plain-text guess used to cover', () => {
    const blocks = [
      block('heading_1', [richText('What is an enzyme?')]),
      block('paragraph', [richText('A protein that speeds up a reaction.')]),
      block('heading_1', [richText('What is a substrate?')]),
      block('paragraph', [richText('The molecule an enzyme acts on.')]),
      block('heading_1', [richText('What is an active site?')]),
      block('paragraph', [richText('The pocket where the substrate binds.')]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'heading',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(3);
    expect(notes[0].name).toContain('enzyme');
    expect(notes[0].back).toContain('speeds up a reaction');
  });
});

describe('induceNotesFromBlocks paragraphs rule', () => {
  it('makes one card per prose paragraph with the bold term as the front', () => {
    const blocks = [
      block('paragraph', [
        richText('Osmosis', { bold: true }),
        richText(' is water moving across a semi-permeable membrane.'),
      ]),
      block('paragraph', [
        richText('Diffusion', { bold: true }),
        richText(' spreads particles from high to low concentration.'),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'paragraphs',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(2);
    expect(notes[0].name).toBe('<strong>Osmosis</strong>');
    expect(notes[0].back).toContain('semi-permeable membrane');
    expect(notes[1].name).toBe('<strong>Diffusion</strong>');
  });

  it('uses a highlighted term as the front when nothing is bold', () => {
    const blocks = [
      block('paragraph', [
        richText('Mitosis', { color: 'yellow_background' }),
        richText(' divides one cell into two identical daughter cells.'),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'paragraphs',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toContain('Mitosis');
    expect(notes[0].name).toContain('background-color');
    expect(notes[0].back).toContain('daughter cells');
  });

  it('falls back to the first sentence when a paragraph has no emphasis', () => {
    const blocks = [
      block('paragraph', [
        richText(
          'Photosynthesis turns light into chemical energy. It happens in the chloroplast.'
        ),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'paragraphs',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toBe(
      'Photosynthesis turns light into chemical energy.'
    );
    expect(notes[0].back).toContain('chloroplast');
  });

  it('escapes markup typed as text in a first-sentence front', () => {
    const blocks = [
      block('paragraph', [
        richText(
          'Typed <b>tags</b> and <img src=x onerror=alert(1)> stay text. '
        ),
        richText('The rest of the paragraph explains it.'),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'paragraphs',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].name).not.toContain('<img');
    expect(notes[0].name).not.toContain('<b>');
    expect(notes[0].name).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(notes[0].name).toContain('&lt;b&gt;tags&lt;/b&gt;');
    expect(notes[0].name).not.toContain('The rest');
  });

  it('keeps real annotations inside a first-sentence front', () => {
    const blocks = [
      block('paragraph', [
        richText('Glycolysis splits '),
        richText('glucose', { italic: true }),
        richText(' into pyruvate in the cytosol. It yields two ATP.'),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'paragraphs',
      settings(),
      new TagRegistry()
    );

    expect(notes[0].name).toContain('<em>glucose</em>');
    expect(notes[0].name).toContain('into pyruvate in the cytosol.');
    expect(notes[0].name).not.toContain('ATP');
  });

  it('cuts a long first sentence at the front limit with an ellipsis', () => {
    const long = `${'word '.repeat(40)}end.`;
    const blocks = [block('paragraph', [richText(long)])];

    const notes = induceNotesFromBlocks(
      blocks,
      'paragraphs',
      settings(),
      new TagRegistry()
    );

    expect(notes[0].name.endsWith('…')).toBe(true);
    expect(notes[0].name.length).toBeLessThanOrEqual(121);
  });

  it('escapes markup typed as text in a bold front and still renders bold', () => {
    const blocks = [
      block('paragraph', [
        richText('<img src=x onerror=alert(1)>', { bold: true }),
        richText(' is what this paragraph is about, as plain text.'),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'paragraphs',
      settings(),
      new TagRegistry()
    );

    expect(notes[0].name).toBe(
      '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>'
    );
  });

  it('skips short paragraphs and blocks that are not paragraphs', () => {
    const blocks = [
      block('paragraph', [richText('Too short to be a card.')]),
      block('heading_2', [
        richText('A heading long enough to pass the paragraph length floor'),
      ]),
      block('quote', [
        richText('A quote long enough to pass the paragraph length floor too'),
      ]),
    ];

    expect(
      induceNotesFromBlocks(blocks, 'paragraphs', settings(), new TagRegistry())
    ).toHaveLength(0);
  });

  it('keeps the whole emphasised run when bold spans several text items', () => {
    const blocks = [
      block('paragraph', [
        richText('Active ', { bold: true }),
        richText('recall', { bold: true, italic: true }),
        richText(' means retrieving a fact from memory instead of rereading.'),
      ]),
    ];

    const notes = induceNotesFromBlocks(
      blocks,
      'paragraphs',
      settings(),
      new TagRegistry()
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].name).toContain('Active');
    expect(notes[0].name).toContain('recall');
    expect(notes[0].name).not.toContain('retrieving');
  });
});

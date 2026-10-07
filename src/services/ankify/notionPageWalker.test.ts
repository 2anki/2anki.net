import { vi } from 'vitest';
import {
  walkNotionPageForFlashcards,
  walkNotionDatabaseForFlashcards,
} from './notionPageWalker';

const toggleBlock = (overrides: Record<string, unknown> = {}) => ({
  id: 'toggle-1',
  type: 'toggle',
  has_children: true,
  last_edited_time: '2026-05-09T12:00:00.000Z',
  toggle: { rich_text: [{ plain_text: 'What is Anki?' }] },
  ...overrides,
});

const paragraphChild = (text: string) => ({
  type: 'paragraph',
  paragraph: { rich_text: [{ plain_text: text }] },
});

describe('walkNotionPageForFlashcards', () => {
  test('extracts hosted image blocks and embeds <img> with ankify-{id}.{ext}', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') {
        return [toggleBlock()];
      }
      return [
        paragraphChild('Spaced repetition.'),
        {
          id: 'img-block-77',
          type: 'image',
          image: {
            type: 'file',
            file: {
              url: 'https://prod-files.notion.so/abc/img.png?signed=1',
              expiry_time: '2026-05-09T13:00:00.000Z',
            },
          },
        },
      ];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].back).toContain('Spaced repetition.');
    expect(cards[0].back).toContain('<img src="ankify-img-block-77.png">');
    expect(cards[0].media).toEqual([
      {
        block_id: 'img-block-77',
        kind: 'image',
        source: 'file',
        url: 'https://prod-files.notion.so/abc/img.png?signed=1',
        filename: 'ankify-img-block-77.png',
      },
    ]);
  });

  test('surfaces unsupported child block types from the toggle back', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') return [toggleBlock()];
      return [paragraphChild('Known text.'), { id: 'weird-1', type: 'html' }];
    });

    const { cards, unsupportedTypes } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards[0].back).toContain('Known text.');
    expect(unsupportedTypes).toEqual(['html']);
  });

  test('rewrites external-hosted image URLs to a local filename in the back HTML', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') {
        return [toggleBlock()];
      }
      return [
        {
          id: 'img-block-ext',
          type: 'image',
          image: {
            type: 'external',
            external: { url: 'https://cdn.example.com/diagram.png' },
          },
        },
      ];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards[0].back).toContain('<img src="ankify-img-block-ext.png">');
    expect(cards[0].media).toEqual([
      {
        block_id: 'img-block-ext',
        kind: 'image',
        source: 'external',
        url: 'https://cdn.example.com/diagram.png',
        filename: 'ankify-img-block-ext.png',
      },
    ]);
  });

  test('rewrites a YouTube external video to an iframe', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') return [toggleBlock()];
      return [
        {
          id: 'vid-1',
          type: 'video',
          video: {
            type: 'external',
            external: { url: 'https://youtu.be/dQw4w9WgXcQ' },
          },
        },
      ];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards[0].back).toContain(
      'src="https://www.youtube.com/embed/dQw4w9WgXcQ?'
    );
    expect(cards[0].media[0]).toMatchObject({
      kind: 'video',
      source: 'external',
    });
  });

  test('emits an Anki [sound:] tag for audio blocks and tracks the file', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') return [toggleBlock()];
      return [
        {
          id: 'a-1',
          type: 'audio',
          audio: {
            type: 'file',
            file: { url: 'https://signed/song.mp3' },
          },
        },
      ];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards[0].back).toContain('[sound:ankify-a-1.mp3]');
    expect(cards[0].media[0]).toMatchObject({
      kind: 'audio',
      filename: 'ankify-a-1.mp3',
      source: 'file',
    });
  });

  test('renders an embed block as an iframe', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') return [toggleBlock()];
      return [
        {
          id: 'em-1',
          type: 'embed',
          embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
        },
      ];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards[0].back).toContain('<iframe');
    expect(cards[0].back).toContain('youtube.com/embed/');
  });

  test('extracts file blocks as download links and tracks them', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') return [toggleBlock()];
      return [
        {
          id: 'f-1',
          type: 'file',
          file: {
            type: 'file',
            file: { url: 'https://signed/notes.pdf' },
            name: 'class-notes.pdf',
          },
        },
      ];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards[0].back).toContain(
      '<a href="ankify-f-1.pdf">class-notes.pdf</a>'
    );
    expect(cards[0].media[0]).toMatchObject({
      kind: 'file',
      filename: 'ankify-f-1.pdf',
    });
  });

  test('recurses into nested toggles inside a parent toggle', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') return [toggleBlock({ id: 'outer' })];
      if (blockId === 'outer') {
        return [
          {
            id: 'inner',
            type: 'toggle',
            has_children: true,
            toggle: { rich_text: [{ plain_text: 'sub-q' }] },
          },
        ];
      }
      if (blockId === 'inner') return [paragraphChild('sub-a')];
      return [];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards[0].back).toContain('<details>');
    expect(cards[0].back).toContain('<summary>sub-q</summary>');
    expect(cards[0].back).toContain('<p>sub-a</p>');
  });

  test('skips toggles with empty front text', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') {
        return [
          toggleBlock({ id: 't-empty', toggle: { rich_text: [] } }),
          toggleBlock({ id: 't-real' }),
        ];
      }
      return [paragraphChild('answer')];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].notion_block_id).toBe('t-real');
  });

  test('carries front text color from rich-text annotation and toggle block color', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') {
        return [
          toggleBlock({
            id: 't-inline',
            toggle: {
              rich_text: [
                { plain_text: 'red word', annotations: { color: 'red' } },
              ],
            },
          }),
          toggleBlock({
            id: 't-block',
            toggle: { rich_text: [{ plain_text: 'blue line' }], color: 'blue' },
          }),
        ];
      }
      return [paragraphChild('answer')];
    });

    const { cards } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(cards.map((c) => c.front)).toEqual([
      '<span class="n2a-highlight-red" style="color: #E03E3E">red word</span>',
      '<span class="n2a-highlight-blue" style="color: #0B6E99">blue line</span>',
    ]);
  });
});

describe('walkNotionPageForFlashcards diagnostic', () => {
  test('diagnostic counts blocks_scanned and blocks_matched from a single toggle page', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') {
        return [toggleBlock({ id: 't-1' }), { id: 'p-1', type: 'paragraph' }];
      }
      return [paragraphChild('answer')];
    });

    const { diagnostic } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(diagnostic.blocks_scanned).toBe(2);
    expect(diagnostic.blocks_matched).toBe(1);
  });

  test('diagnostic records toggle hits in pattern_hits', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') {
        return [toggleBlock({ id: 't-1' }), toggleBlock({ id: 't-2' })];
      }
      return [paragraphChild('a')];
    });

    const { diagnostic } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(diagnostic.pattern_hits['toggle']).toBe(2);
  });

  test('diagnostic captures unmatched_samples (heading text) for non-toggle blocks up to 3', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') {
        return [
          {
            id: 'p-1',
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Block one' }] },
          },
          {
            id: 'p-2',
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Block two' }] },
          },
          {
            id: 'p-3',
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Block three' }] },
          },
          {
            id: 'p-4',
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Block four' }] },
          },
        ];
      }
      return [];
    });

    const { diagnostic } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(diagnostic.unmatched_samples).toHaveLength(3);
    expect(diagnostic.unmatched_samples![0]).toBe('Block one');
    expect(diagnostic.unmatched_samples![2]).toBe('Block three');
  });

  test('diagnostic blocks_scanned is capped at 1000', async () => {
    const manyBlocks = Array.from({ length: 1200 }, (_, i) => ({
      id: `p-${i}`,
      type: 'paragraph',
      paragraph: { rich_text: [{ plain_text: `Block ${i}` }] },
    }));
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') return manyBlocks;
      return [];
    });

    const { diagnostic } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(diagnostic.blocks_scanned).toBe(1000);
  });

  test('diagnostic blocks_matched is 0 and unmatched_samples is populated when no toggles found', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'page-id') {
        return [
          {
            id: 'p-1',
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Introduction' }] },
          },
        ];
      }
      return [];
    });

    const { diagnostic } = await walkNotionPageForFlashcards(
      'page-id',
      fetchChildren as never
    );

    expect(diagnostic.blocks_matched).toBe(0);
    expect(diagnostic.unmatched_samples).toEqual(['Introduction']);
  });
});

describe('walkNotionDatabaseForFlashcards', () => {
  const rowToggle = (id: string, front: string) => ({
    id: `${id}-toggle`,
    type: 'toggle',
    has_children: true,
    last_edited_time: '2026-05-09T12:00:00.000Z',
    toggle: { rich_text: [{ plain_text: front }] },
  });

  test('walks every database row-page and aggregates the cards', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'row-1') return [rowToggle('row-1', 'Front 1')];
      if (blockId === 'row-2') return [rowToggle('row-2', 'Front 2')];
      if (blockId === 'row-1-toggle') return [paragraphChild('Back 1')];
      if (blockId === 'row-2-toggle') return [paragraphChild('Back 2')];
      return [];
    });
    const fetchDatabasePages = vi.fn(async () => [
      { id: 'row-1' },
      { id: 'row-2' },
    ]);

    const { cards, diagnostic } = await walkNotionDatabaseForFlashcards(
      'database-id',
      fetchChildren as never,
      fetchDatabasePages
    );

    expect(fetchDatabasePages).toHaveBeenCalledWith('database-id');
    expect(cards.map((c) => c.front)).toEqual(['Front 1', 'Front 2']);
    expect(cards[0].back).toContain('Back 1');
    expect(cards[1].back).toContain('Back 2');
    expect(diagnostic.blocks_matched).toBe(2);
    expect(diagnostic.pattern_hits).toEqual({ toggle: 2 });
  });

  test('tags every card with the child page id and title', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'row-1') return [rowToggle('row-1', 'Front 1')];
      if (blockId === 'row-2') return [rowToggle('row-2', 'Front 2')];
      return [];
    });
    const fetchDatabasePages = vi.fn(async () => [
      { id: 'row-1', title: 'Cell Biology' },
      { id: 'row-2', title: null },
    ]);

    const { cards } = await walkNotionDatabaseForFlashcards(
      'database-id',
      fetchChildren as never,
      fetchDatabasePages
    );

    expect(
      cards.map((c) => ({
        page_id: c.notion_page_id,
        page_title: c.notion_page_title,
      }))
    ).toEqual([
      { page_id: 'row-1', page_title: 'Cell Biology' },
      { page_id: 'row-2', page_title: null },
    ]);
  });

  test('keeps the cards in the order the pages were returned', async () => {
    const fetchChildren = vi.fn(async (blockId: string) => {
      if (blockId === 'row-1') return [rowToggle('row-1', 'Front 1')];
      if (blockId === 'row-2') return [rowToggle('row-2', 'Front 2')];
      if (blockId === 'row-3') return [rowToggle('row-3', 'Front 3')];
      return [];
    });
    const fetchDatabasePages = vi.fn(async () => [
      { id: 'row-2' },
      { id: 'row-3' },
      { id: 'row-1' },
    ]);

    const { cards } = await walkNotionDatabaseForFlashcards(
      'database-id',
      fetchChildren as never,
      fetchDatabasePages
    );

    expect(cards.map((c) => c.front)).toEqual([
      'Front 2',
      'Front 3',
      'Front 1',
    ]);
  });

  test('caps the number of database rows walked at 250', async () => {
    const pages = Array.from({ length: 300 }, (_v, i) => ({ id: `row-${i}` }));
    const fetchChildren = vi.fn(async () => []);
    const fetchDatabasePages = vi.fn(async () => pages);

    await walkNotionDatabaseForFlashcards(
      'database-id',
      fetchChildren as never,
      fetchDatabasePages
    );

    expect(fetchChildren).toHaveBeenCalledTimes(250);
  });

  test('returns zero cards for an empty database', async () => {
    const fetchChildren = vi.fn(async () => []);
    const fetchDatabasePages = vi.fn(async () => []);

    const { cards, diagnostic } = await walkNotionDatabaseForFlashcards(
      'database-id',
      fetchChildren as never,
      fetchDatabasePages
    );

    expect(cards).toEqual([]);
    expect(diagnostic.blocks_scanned).toBe(0);
    expect(diagnostic.blocks_matched).toBe(0);
  });
});

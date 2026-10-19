import { renderNotionBlocks } from './renderBlocks';
import { NotionBlockChildrenFetcher, NotionRenderableBlock } from './types';

const noChildren: NotionBlockChildrenFetcher = async () => [];

const fetcherFor = (
  byParent: Record<string, NotionRenderableBlock[]>
): NotionBlockChildrenFetcher => {
  return async (id: string) => byParent[id] ?? [];
};

const para = (text: string): NotionRenderableBlock => ({
  type: 'paragraph',
  paragraph: { rich_text: [{ plain_text: text }] },
});

describe('renderNotionBlocks — text blocks', () => {
  it('renders a paragraph as <p>', async () => {
    const out = await renderNotionBlocks([para('hello')], noChildren);
    expect(out.html).toBe('<p>hello</p>');
    expect(out.media).toEqual([]);
  });

  it('wraps a block-colored paragraph, heading, and list item in a color class', async () => {
    const blocks: NotionRenderableBlock[] = [
      {
        type: 'paragraph',
        paragraph: { rich_text: [{ plain_text: 'p' }], color: 'red' },
      },
      {
        type: 'heading_2',
        heading_2: { rich_text: [{ plain_text: 'h' }], color: 'blue' },
      },
      {
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ plain_text: 'n' }],
          color: 'purple',
        },
      },
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.html).toBe(
      '<p><span class="n2a-highlight-red" style="color: #E03E3E">p</span></p>\n' +
        '<h2><span class="n2a-highlight-blue" style="color: #0B6E99">h</span></h2>\n' +
        '<ol><li><span class="n2a-highlight-purple" style="color: #6940A5">n</span></li></ol>'
    );
  });

  it('leaves a default-colored block unwrapped', async () => {
    const out = await renderNotionBlocks(
      [
        {
          type: 'paragraph',
          paragraph: { rich_text: [{ plain_text: 'x' }], color: 'default' },
        },
      ],
      noChildren
    );
    expect(out.html).toBe('<p>x</p>');
  });

  it('renders headings 1/2/3 (and folds heading_4 into h3)', async () => {
    const blocks: NotionRenderableBlock[] = [
      { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'A' }] } },
      { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'B' }] } },
      { type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'C' }] } },
      { type: 'heading_4', heading_3: { rich_text: [{ plain_text: 'D' }] } },
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.html).toBe('<h1>A</h1>\n<h2>B</h2>\n<h3>C</h3>\n<h3>D</h3>');
  });

  it('groups adjacent bulleted_list_items into one <ul>', async () => {
    const blocks: NotionRenderableBlock[] = [
      {
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ plain_text: 'one' }] },
      },
      {
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ plain_text: 'two' }] },
      },
      para('break'),
      {
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ plain_text: 'three' }] },
      },
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.html).toBe(
      '<ul><li>one</li><li>two</li></ul>\n<p>break</p>\n<ul><li>three</li></ul>'
    );
  });

  it('groups numbered list items into <ol> separately from <ul>', async () => {
    const blocks: NotionRenderableBlock[] = [
      {
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ plain_text: 'one' }] },
      },
      {
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ plain_text: 'a' }] },
      },
      {
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ plain_text: 'two' }] },
      },
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.html).toBe(
      '<ol><li>one</li></ol>\n<ul><li>a</li></ul>\n<ol><li>two</li></ol>'
    );
  });

  it('renders to_do with checked / unchecked markers', async () => {
    const blocks: NotionRenderableBlock[] = [
      {
        type: 'to_do',
        to_do: { rich_text: [{ plain_text: 'done' }], checked: true },
      },
      {
        type: 'to_do',
        to_do: { rich_text: [{ plain_text: 'todo' }], checked: false },
      },
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.html).toBe(
      '<div class="todo">☑ done</div>\n<div class="todo">☐ todo</div>'
    );
  });

  it('renders quote, divider, code, equation', async () => {
    const blocks: NotionRenderableBlock[] = [
      { type: 'quote', quote: { rich_text: [{ plain_text: 'said' }] } },
      { type: 'divider', divider: {} },
      {
        type: 'code',
        code: {
          rich_text: [{ plain_text: 'console.log("hi")' }],
          language: 'javascript',
        },
      },
      { type: 'equation', equation: { expression: 'a + b' } },
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.html).toContain('<blockquote>said</blockquote>');
    expect(out.html).toContain('<hr>');
    expect(out.html).toContain('<pre><code class="hljs language-javascript">');
    expect(out.html).toContain(
      '<span class="hljs-string">&quot;hi&quot;</span>'
    );
    expect(out.html).toContain('\\[a + b\\]');
  });

  it('renders inline equations in rich text with inline delimiters', async () => {
    const blocks: NotionRenderableBlock[] = [
      {
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { plain_text: 'where ' },
            { type: 'equation', equation: { expression: 'x^2' } },
          ],
        },
      },
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.html).toContain('\\(x^2\\)');
    expect(out.html).not.toContain('\\[x^2\\]');
  });
});

describe('renderNotionBlocks — recursion', () => {
  it('recurses into toggle children and emits <details>', async () => {
    const root: NotionRenderableBlock = {
      id: 'tog1',
      type: 'toggle',
      has_children: true,
      toggle: { rich_text: [{ plain_text: 'Q' }] },
    };
    const fetch = fetcherFor({ tog1: [para('A')] });
    const out = await renderNotionBlocks([root], fetch);
    expect(out.html).toBe('<details><summary>Q</summary><p>A</p></details>');
  });

  it('handles nested toggles up to maxDepth and stops past it', async () => {
    const fetch = fetcherFor({
      a: [
        {
          id: 'b',
          type: 'toggle',
          has_children: true,
          toggle: { rich_text: [{ plain_text: 'b' }] },
        },
      ],
      b: [
        {
          id: 'c',
          type: 'toggle',
          has_children: true,
          toggle: { rich_text: [{ plain_text: 'c' }] },
        },
      ],
      c: [para('deep')],
    });
    const root: NotionRenderableBlock = {
      id: 'a',
      type: 'toggle',
      has_children: true,
      toggle: { rich_text: [{ plain_text: 'a' }] },
    };
    const shallow = await renderNotionBlocks([root], fetch, { maxDepth: 2 });
    expect(shallow.html).not.toContain('deep');

    const deep = await renderNotionBlocks([root], fetch, { maxDepth: 8 });
    expect(deep.html).toContain('deep');
  });

  it('renders callout text + emoji + nested children', async () => {
    const fetch = fetcherFor({ co: [para('inside')] });
    const block: NotionRenderableBlock = {
      id: 'co',
      type: 'callout',
      has_children: true,
      callout: {
        rich_text: [{ plain_text: 'note' }],
        icon: { type: 'emoji', emoji: '💡' },
      },
    };
    const out = await renderNotionBlocks([block], fetch);
    expect(out.html).toContain('💡 note');
    expect(out.html).toContain('<p>inside</p>');
    expect(out.html).toContain('class="callout"');
  });

  it('nests callout children inside the callout div, not after it', async () => {
    const fetch = fetcherFor({ co: [para('inside')] });
    const block: NotionRenderableBlock = {
      id: 'co',
      type: 'callout',
      has_children: true,
      callout: { rich_text: [{ plain_text: 'note' }] },
    };
    const out = await renderNotionBlocks([block], fetch);
    expect(out.html).toBe('<div class="callout">note<p>inside</p></div>');
    const childOpen = out.html.indexOf('<p>inside</p>');
    const divClose = out.html.lastIndexOf('</div>');
    expect(childOpen).toBeLessThan(divClose);
    expect(out.html.slice(divClose)).not.toContain('inside');
  });
});

describe('renderNotionBlocks — nested lists', () => {
  const bullet = (
    text: string,
    extra: Partial<NotionRenderableBlock> = {}
  ): NotionRenderableBlock => ({
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ plain_text: text }] },
    ...extra,
  });

  const numbered = (
    text: string,
    extra: Partial<NotionRenderableBlock> = {}
  ): NotionRenderableBlock => ({
    type: 'numbered_list_item',
    numbered_list_item: { rich_text: [{ plain_text: text }] },
    ...extra,
  });

  it('nests a bulleted item’s sub-bullets as a <ul> inside its <li>', async () => {
    const parent = bullet('parent', { id: 'p1', has_children: true });
    const fetch = fetcherFor({ p1: [bullet('childA'), bullet('childB')] });
    const out = await renderNotionBlocks([parent], fetch);
    expect(out.html).toBe(
      '<ul><li>parent<ul><li>childA</li><li>childB</li></ul></li></ul>'
    );
  });

  it('nests a numbered item’s children as an <ol> inside its <li>', async () => {
    const parent = numbered('Step one', { id: 'n1', has_children: true });
    const fetch = fetcherFor({ n1: [numbered('sub')] });
    const out = await renderNotionBlocks([parent], fetch);
    expect(out.html).toBe('<ol><li>Step one<ol><li>sub</li></ol></li></ol>');
  });

  it('nests a non-list child (paragraph) inside the list item', async () => {
    const parent = bullet('point', { id: 'p2', has_children: true });
    const fetch = fetcherFor({ p2: [para('detail')] });
    const out = await renderNotionBlocks([parent], fetch);
    expect(out.html).toBe('<ul><li>point<p>detail</p></li></ul>');
  });

  it('keeps sibling grouping while nesting one item’s children', async () => {
    const blocks: NotionRenderableBlock[] = [
      bullet('parent', { id: 'p3', has_children: true }),
      bullet('sibling'),
    ];
    const fetch = fetcherFor({ p3: [bullet('child')] });
    const out = await renderNotionBlocks(blocks, fetch);
    expect(out.html).toBe(
      '<ul><li>parent<ul><li>child</li></ul></li><li>sibling</li></ul>'
    );
  });

  it('recurses through multiple levels of sub-bullets', async () => {
    const fetch = fetcherFor({
      l1: [bullet('level2', { id: 'l2', has_children: true })],
      l2: [bullet('level3')],
    });
    const out = await renderNotionBlocks(
      [bullet('level1', { id: 'l1', has_children: true })],
      fetch
    );
    expect(out.html).toBe(
      '<ul><li>level1<ul><li>level2<ul><li>level3</li></ul></li></ul></li></ul>'
    );
  });

  it('does not fetch children for a flat list item without has_children', async () => {
    const calls: string[] = [];
    const fetch: NotionBlockChildrenFetcher = async (id) => {
      calls.push(id);
      return [];
    };
    const out = await renderNotionBlocks(
      [bullet('flat', { id: 'flat1' })],
      fetch
    );
    expect(out.html).toBe('<ul><li>flat</li></ul>');
    expect(calls).toEqual([]);
  });

  it('stops nesting at maxDepth', async () => {
    const fetch = fetcherFor({
      a: [bullet('b', { id: 'b', has_children: true })],
      b: [bullet('deep-child')],
    });
    const out = await renderNotionBlocks(
      [bullet('a', { id: 'a', has_children: true })],
      fetch,
      { maxDepth: 1 }
    );
    expect(out.html).not.toContain('deep-child');
  });
});

describe('renderNotionBlocks — media', () => {
  it('rewrites an external image to a local filename and emits a media ref carrying that filename', async () => {
    const block: NotionRenderableBlock = {
      id: 'img1',
      type: 'image',
      image: { type: 'external', external: { url: 'https://x/i.png' } },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toBe('<img src="ankify-img1.png">');
    expect(out.media).toEqual([
      {
        block_id: 'img1',
        kind: 'image',
        source: 'external',
        url: 'https://x/i.png',
        filename: 'ankify-img1.png',
      },
    ]);
  });

  it('emits a file image with ankify-{id}.{ext} filename and a file media ref', async () => {
    const block: NotionRenderableBlock = {
      id: 'img2',
      type: 'image',
      image: {
        type: 'file',
        file: { url: 'https://signed-url/file.JPG?x=1' },
      },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toContain('<img src="ankify-img2.jpg">');
    expect(out.media[0]).toMatchObject({
      block_id: 'img2',
      kind: 'image',
      source: 'file',
      filename: 'ankify-img2.jpg',
    });
  });

  it('rewrites a YouTube external video to an iframe and emits a media ref', async () => {
    const block: NotionRenderableBlock = {
      id: 'v1',
      type: 'video',
      video: {
        type: 'external',
        external: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toContain(
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?'
    );
    expect(out.media[0]).toMatchObject({
      block_id: 'v1',
      kind: 'video',
      source: 'external',
    });
  });

  it('rewrites a Vimeo external video to player.vimeo.com', async () => {
    const block: NotionRenderableBlock = {
      id: 'v2',
      type: 'video',
      video: {
        type: 'external',
        external: { url: 'https://vimeo.com/123' },
      },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toContain('https://player.vimeo.com/video/123');
  });

  it('downloads a hosted video as ankify-{id}.{ext} and emits a file media ref', async () => {
    const block: NotionRenderableBlock = {
      id: 'v3',
      type: 'video',
      video: {
        type: 'file',
        file: { url: 'https://signed/clip.MP4?token=abc' },
      },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toContain('<video controls src="ankify-v3.mp4"></video>');
    expect(out.media[0]).toMatchObject({
      block_id: 'v3',
      kind: 'video',
      source: 'file',
      filename: 'ankify-v3.mp4',
    });
  });

  it('emits an Anki [sound:] tag for audio blocks', async () => {
    const block: NotionRenderableBlock = {
      id: 'au1',
      type: 'audio',
      audio: {
        type: 'external',
        external: { url: 'https://x/clip.mp3' },
      },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toContain('[sound:ankify-au1.mp3]');
    expect(out.media[0]).toMatchObject({
      block_id: 'au1',
      kind: 'audio',
      filename: 'ankify-au1.mp3',
    });
  });

  it('emits a download link for file blocks (using name when present)', async () => {
    const block: NotionRenderableBlock = {
      id: 'f1',
      type: 'file',
      file: {
        type: 'file',
        file: { url: 'https://x/notes.pdf?t=1' },
        name: 'class-notes.pdf',
      },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toContain('<a href="ankify-f1.pdf">class-notes.pdf</a>');
    expect(out.media[0]).toMatchObject({
      kind: 'file',
      filename: 'ankify-f1.pdf',
    });
  });

  it('emits an iframe for pdf blocks and tracks the file', async () => {
    const block: NotionRenderableBlock = {
      id: 'pdf1',
      type: 'pdf',
      pdf: {
        type: 'file',
        file: { url: 'https://x/doc.pdf' },
      },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toContain('<iframe src="ankify-pdf1.pdf"');
    expect(out.media[0]).toMatchObject({
      kind: 'file',
      filename: 'ankify-pdf1.pdf',
    });
  });

  it('rewrites embed YouTube to iframe and embed Twitter to source link', async () => {
    const yt: NotionRenderableBlock = {
      id: 'e1',
      type: 'embed',
      embed: { url: 'https://youtu.be/abcdefghijk' },
    };
    const tw: NotionRenderableBlock = {
      id: 'e2',
      type: 'embed',
      embed: { url: 'https://twitter.com/u/status/1' },
    };
    const out = await renderNotionBlocks([yt, tw], noChildren);
    expect(out.html).toContain('<iframe');
    expect(out.html).toContain(
      '<div class="source"><a href="https://twitter.com/u/status/1">'
    );
  });

  it('renders bookmark blocks as a plain anchor', async () => {
    const block: NotionRenderableBlock = {
      id: 'b1',
      type: 'bookmark',
      bookmark: { url: 'https://example.com/x' },
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toBe(
      '<a href="https://example.com/x">https://example.com/x</a>'
    );
  });

  it('skips unknown block types silently', async () => {
    const block: NotionRenderableBlock = {
      id: 'mystery',
      type: 'something_new',
    };
    const out = await renderNotionBlocks([block], noChildren);
    expect(out.html).toBe('');
    expect(out.media).toEqual([]);
  });

  it('collects each unknown block type in unsupportedTypes', async () => {
    const blocks: NotionRenderableBlock[] = [
      { id: 'a', type: 'html' },
      { id: 'b', type: 'html' },
      { id: 'c', type: 'unsupported_widget' },
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.unsupportedTypes).toEqual([
      'html',
      'html',
      'unsupported_widget',
    ]);
  });

  it('renders known siblings around an unknown block without dropping them', async () => {
    const blocks: NotionRenderableBlock[] = [
      para('before'),
      { id: 'x', type: 'html' },
      para('after'),
    ];
    const out = await renderNotionBlocks(blocks, noChildren);
    expect(out.html).toBe('<p>before</p>\n<p>after</p>');
    expect(out.unsupportedTypes).toEqual(['html']);
  });

  it('returns an empty unsupportedTypes array when every block is known', async () => {
    const out = await renderNotionBlocks([para('hello')], noChildren);
    expect(out.unsupportedTypes).toEqual([]);
  });
});

describe('renderNotionBlocks — tables', () => {
  const row = (...cells: string[][]): NotionRenderableBlock => ({
    type: 'table_row',
    table_row: {
      cells: cells.map((texts) => texts.map((t) => ({ plain_text: t }))),
    },
  });

  it('renders a table with rows and cells as <td> (was dropped)', async () => {
    const table: NotionRenderableBlock = {
      id: 't1',
      type: 'table',
      has_children: true,
      table: { has_column_header: false },
    };
    const fetch = fetcherFor({
      t1: [row(['A1'], ['B1']), row(['A2'], ['B2'])],
    });
    const out = await renderNotionBlocks([table], fetch);
    expect(out.html).toBe(
      '<table><tbody>' +
        '<tr><td>A1</td><td>B1</td></tr>' +
        '<tr><td>A2</td><td>B2</td></tr>' +
        '</tbody></table>'
    );
  });

  it('renders the first row as <thead>/<th> when has_column_header is set', async () => {
    const table: NotionRenderableBlock = {
      id: 't2',
      type: 'table',
      has_children: true,
      table: { has_column_header: true },
    };
    const fetch = fetcherFor({
      t2: [row(['Term'], ['Definition']), row(['ATP'], ['energy'])],
    });
    const out = await renderNotionBlocks([table], fetch);
    expect(out.html).toBe(
      '<table>' +
        '<thead><tr><th>Term</th><th>Definition</th></tr></thead>' +
        '<tbody><tr><td>ATP</td><td>energy</td></tr></tbody>' +
        '</table>'
    );
  });

  it('renders known siblings around a table without dropping them', async () => {
    const table: NotionRenderableBlock = {
      id: 't3',
      type: 'table',
      has_children: true,
      table: {},
    };
    const fetch = fetcherFor({ t3: [row(['x'])] });
    const out = await renderNotionBlocks(
      [para('before'), table, para('after')],
      fetch
    );
    expect(out.html).toBe(
      '<p>before</p>\n' +
        '<table><tbody><tr><td>x</td></tr></tbody></table>\n' +
        '<p>after</p>'
    );
  });
});

describe('renderNotionBlocks — columns', () => {
  it('renders all columns content in a column_list (was dropped)', async () => {
    const columnList: NotionRenderableBlock = {
      id: 'cl1',
      type: 'column_list',
      has_children: true,
    };
    const fetch = fetcherFor({
      cl1: [
        { id: 'col1', type: 'column', has_children: true },
        { id: 'col2', type: 'column', has_children: true },
      ],
      col1: [para('left one'), para('left two')],
      col2: [para('right one')],
    });
    const out = await renderNotionBlocks([columnList], fetch);
    expect(out.html).toContain('<p>left one</p>');
    expect(out.html).toContain('<p>left two</p>');
    expect(out.html).toContain('<p>right one</p>');
  });

  it('renders nested content (a toggle) inside a column', async () => {
    const columnList: NotionRenderableBlock = {
      id: 'cl2',
      type: 'column_list',
      has_children: true,
    };
    const fetch = fetcherFor({
      cl2: [{ id: 'col', type: 'column', has_children: true }],
      col: [
        {
          id: 'tog',
          type: 'toggle',
          has_children: true,
          toggle: { rich_text: [{ plain_text: 'Q' }] },
        },
      ],
      tog: [para('deep answer')],
    });
    const out = await renderNotionBlocks([columnList], fetch);
    expect(out.html).toContain(
      '<details><summary>Q</summary><p>deep answer</p></details>'
    );
  });

  it('renders known siblings around a column_list without dropping them', async () => {
    const columnList: NotionRenderableBlock = {
      id: 'cl3',
      type: 'column_list',
      has_children: true,
    };
    const fetch = fetcherFor({
      cl3: [{ id: 'colA', type: 'column', has_children: true }],
      colA: [para('inside column')],
    });
    const out = await renderNotionBlocks(
      [para('before'), columnList, para('after')],
      fetch
    );
    expect(out.html).toBe('<p>before</p>\n<p>inside column</p>\n<p>after</p>');
  });

  it('collects media from an image inside a column subtree', async () => {
    const columnList: NotionRenderableBlock = {
      id: 'cl4',
      type: 'column_list',
      has_children: true,
    };
    const fetch = fetcherFor({
      cl4: [{ id: 'colX', type: 'column', has_children: true }],
      colX: [
        {
          id: 'imgcol',
          type: 'image',
          image: { type: 'external', external: { url: 'https://x/c.png' } },
        },
      ],
    });
    const out = await renderNotionBlocks([columnList], fetch);
    expect(out.html).toContain('<img src="ankify-imgcol.png">');
    expect(out.media).toEqual([
      {
        block_id: 'imgcol',
        kind: 'image',
        source: 'external',
        url: 'https://x/c.png',
        filename: 'ankify-imgcol.png',
      },
    ]);
  });
});

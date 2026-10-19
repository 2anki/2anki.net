import {
  isExpandable,
  renderBlockSummary,
  renderBlockPreview,
} from './renderBlockPreview';
import {
  BlockObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import renderTextChildren from './renderTextChildren';
import CardOption from '../../../lib/parser/Settings';

function makeBlock(
  type: string,
  data: Record<string, unknown>
): BlockObjectResponse {
  return {
    type,
    [type]: data,
    object: 'block',
    id: 'test-id',
  } as unknown as BlockObjectResponse; // minimal fixture; Notion SDK types require full shape
}

function makeLinkItem(plainText: string, href: string): RichTextItemResponse {
  return {
    type: 'text',
    plain_text: plainText,
    href,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
    text: { content: plainText, link: { url: href } },
  } as unknown as RichTextItemResponse;
}

function makeParagraph(items: RichTextItemResponse[]): BlockObjectResponse {
  return makeBlock('paragraph', { rich_text: items, color: 'default' });
}

describe('isExpandable', () => {
  it('returns true for toggle', () => {
    const block = makeBlock('toggle', { rich_text: [] });
    expect(isExpandable(block)).toBe(true);
  });

  it('returns true for column_list', () => {
    const block = makeBlock('column_list', {});
    expect(isExpandable(block)).toBe(true);
  });

  it('returns true for column', () => {
    const block = makeBlock('column', {});
    expect(isExpandable(block)).toBe(true);
  });

  it('returns true for table', () => {
    const block = makeBlock('table', {
      table_width: 2,
      has_column_header: false,
      has_row_header: false,
    });
    expect(isExpandable(block)).toBe(true);
  });

  it('returns false for paragraph', () => {
    const block = makeBlock('paragraph', { rich_text: [] });
    expect(isExpandable(block)).toBe(false);
  });
});

describe('renderBlockSummary', () => {
  it('returns Columns label for column_list', () => {
    const block = makeBlock('column_list', {});
    expect(renderBlockSummary(block)).toBe(
      '<p class="block-label">Columns</p>'
    );
  });

  it('returns Column label for column', () => {
    const block = makeBlock('column', {});
    expect(renderBlockSummary(block)).toBe('<p class="block-label">Column</p>');
  });

  it('returns Table label for table', () => {
    const block = makeBlock('table', { table_width: 2 });
    expect(renderBlockSummary(block)).toBe('<p class="block-label">Table</p>');
  });
});

describe('renderBlockPreview — expandable containers return empty string', () => {
  it.each(['column_list', 'column', 'table'])(
    '%s returns empty string',
    (type) => {
      const block = makeBlock(type, {});
      expect(renderBlockPreview(block)).toBe('');
    }
  );
});

describe('renderBlockPreview — table_row', () => {
  it('joins cells with pipe separator', () => {
    const block = makeBlock('table_row', {
      cells: [
        [
          {
            type: 'text',
            plain_text: 'Front',
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default',
            },
            href: null,
          },
        ],
        [
          {
            type: 'text',
            plain_text: 'Back',
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default',
            },
            href: null,
          },
        ],
      ],
    });
    expect(renderBlockPreview(block)).toBe('<p>Front | Back</p>');
  });

  it('renders empty cells as empty strings', () => {
    const block = makeBlock('table_row', { cells: [[], []] });
    expect(renderBlockPreview(block)).toBe('<p> | </p>');
  });
});

describe('renderBlockPreview — embed', () => {
  it('renders a link with Embed label', () => {
    const block = makeBlock('embed', { url: 'https://example.com/embed' });
    const html = renderBlockPreview(block);
    expect(html).toContain('href="https://example.com/embed"');
    expect(html).toContain('Embed: https://example.com/embed');
  });

  it('escapes XSS in URL', () => {
    const block = makeBlock('embed', { url: 'https://evil.com/<script>' });
    expect(renderBlockPreview(block)).toContain('&lt;script&gt;');
  });

  it('returns empty string when URL is falsy', () => {
    const block = makeBlock('embed', { url: '' });
    expect(renderBlockPreview(block)).toBe('');
  });
});

describe('renderBlockPreview — video', () => {
  it('renders external video link', () => {
    const block = makeBlock('video', {
      type: 'external',
      external: { url: 'https://youtube.com/watch?v=abc' },
    });
    const html = renderBlockPreview(block);
    expect(html).toContain('href="https://youtube.com/watch?v=abc"');
    expect(html).toContain('Video:');
  });

  it('renders file video link', () => {
    const block = makeBlock('video', {
      type: 'file',
      file: { url: 'https://s3.example.com/video.mp4', expiry_time: '' },
    });
    const html = renderBlockPreview(block);
    expect(html).toContain('Video:');
    expect(html).toContain('https://s3.example.com/video.mp4');
  });
});

describe('renderBlockPreview — pdf', () => {
  it('renders external PDF link', () => {
    const block = makeBlock('pdf', {
      type: 'external',
      external: { url: 'https://example.com/doc.pdf' },
    });
    expect(renderBlockPreview(block)).toContain('PDF:');
  });

  it('renders file PDF link', () => {
    const block = makeBlock('pdf', {
      type: 'file',
      file: { url: 'https://s3.example.com/doc.pdf', expiry_time: '' },
    });
    expect(renderBlockPreview(block)).toContain('PDF:');
  });
});

describe('renderBlockPreview — audio', () => {
  it('renders external audio link', () => {
    const block = makeBlock('audio', {
      type: 'external',
      external: { url: 'https://example.com/audio.mp3' },
    });
    expect(renderBlockPreview(block)).toContain('Audio:');
  });
});

describe('renderBlockPreview — file', () => {
  it('renders external file link', () => {
    const block = makeBlock('file', {
      type: 'external',
      external: { url: 'https://example.com/data.csv' },
    });
    expect(renderBlockPreview(block)).toContain('File:');
  });
});

describe('renderBlockPreview — link_to_page', () => {
  it('renders page_id link', () => {
    const block = makeBlock('link_to_page', {
      type: 'page_id',
      page_id: 'abc-123',
    });
    const html = renderBlockPreview(block);
    expect(html).toContain('href="/notion/abc-123"');
    expect(html).toContain('Link to page');
  });

  it('renders database_id link', () => {
    const block = makeBlock('link_to_page', {
      type: 'database_id',
      database_id: 'db-456',
    });
    const html = renderBlockPreview(block);
    expect(html).toContain('href="/notion/db-456"');
  });

  it('escapes XSS in linked ID', () => {
    const block = makeBlock('link_to_page', {
      type: 'page_id',
      page_id: '<script>bad</script>',
    });
    const html = renderBlockPreview(block);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderBlockPreview — link_preview', () => {
  it('renders a labeled link', () => {
    const block = makeBlock('link_preview', {
      url: 'https://figma.com/file/abc',
    });
    const html = renderBlockPreview(block);
    expect(html).toContain('Link preview:');
    expect(html).toContain('href="https://figma.com/file/abc"');
  });

  it('escapes XSS in URL', () => {
    const block = makeBlock('link_preview', {
      url: 'https://x.com/"onload=alert(1)',
    });
    expect(renderBlockPreview(block)).toContain('&quot;');
  });
});

describe('renderBlockPreview — rich-text hyperlinks', () => {
  it('renders a link with rel="noopener noreferrer"', () => {
    const html = renderBlockPreview(
      makeParagraph([makeLinkItem('Anki docs', 'https://docs.ankiweb.net/')])
    );
    expect(html).toContain('href="https://docs.ankiweb.net/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('drops a javascript: href and keeps the plain text', () => {
    const html = renderBlockPreview(
      makeParagraph([makeLinkItem('click me', 'javascript:alert(1)')])
    );
    expect(html).toBe('<p>click me</p>');
    expect(html).not.toContain('<a');
  });

  it('drops a data: href and keeps the plain text', () => {
    const html = renderBlockPreview(
      makeParagraph([
        makeLinkItem('payload', 'data:text/html,<script>alert(1)</script>'),
      ])
    );
    expect(html).not.toContain('<a');
  });
});

describe('renderBlockPreview — parity with the conversion renderer', () => {
  const settings = new CardOption(CardOption.LoadDefaultOptions());

  it('produces the same anchor markup as renderTextChildren for a plain link', () => {
    const item = makeLinkItem(
      'Anki documentation',
      'https://docs.ankiweb.net/'
    );
    const converted = renderTextChildren([item], settings);

    expect(renderBlockPreview(makeParagraph([item]))).toBe(
      `<p>${converted}</p>`
    );
  });
});

describe('renderBlockPreview — static placeholders', () => {
  it('breadcrumb renders placeholder', () => {
    const block = makeBlock('breadcrumb', {});
    expect(renderBlockPreview(block)).toBe('<p><em>(breadcrumb)</em></p>');
  });

  it('table_of_contents renders placeholder', () => {
    const block = makeBlock('table_of_contents', { color: 'default' });
    expect(renderBlockPreview(block)).toBe(
      '<p><em>(table of contents)</em></p>'
    );
  });

  it('synced_block renders placeholder', () => {
    const block = makeBlock('synced_block', { synced_from: null });
    expect(renderBlockPreview(block)).toBe('<p><em>(synced block)</em></p>');
  });

  it('template renders placeholder', () => {
    const block = makeBlock('template', { rich_text: [] });
    expect(renderBlockPreview(block)).toBe('<p><em>(template)</em></p>');
  });

  it('unsupported renders placeholder', () => {
    const block = makeBlock('unsupported', {});
    expect(renderBlockPreview(block)).toBe(
      '<p><em>(unsupported block)</em></p>'
    );
  });
});

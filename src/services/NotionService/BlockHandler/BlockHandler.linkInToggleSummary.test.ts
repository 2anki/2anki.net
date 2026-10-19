import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Note from '../../../lib/parser/Note';
import ParserRules from '../../../lib/parser/ParserRules';
import CardOption from '../../../lib/parser/Settings/CardOption';
import Workspace from '../../../lib/parser/WorkSpace';
import { setupTests } from '../../../test/configure-jest';
import MockNotionAPI from '../_mock/MockNotionAPI';
import BlockHandler from './BlockHandler';

const defaultAnnotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default' as const,
};

type TestRichText = {
  type: 'text';
  text: { content: string; link: { url: string } | null };
  annotations: typeof defaultAnnotations;
  plain_text: string;
  href: string | null;
};

function linkText(content: string, href: string): TestRichText {
  return {
    type: 'text',
    text: { content, link: { url: href } },
    annotations: { ...defaultAnnotations },
    plain_text: content,
    href,
  };
}

function plainText(content: string): TestRichText {
  return {
    type: 'text',
    text: { content, link: null },
    annotations: { ...defaultAnnotations },
    plain_text: content,
    href: null,
  };
}

function toggleWithSummary(id: string, summary: TestRichText[]) {
  return {
    object: 'block' as const,
    id,
    parent: { type: 'page_id' as const, page_id: 'page-id' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user' as const, id: 'user-id' },
    last_edited_by: { object: 'user' as const, id: 'user-id' },
    has_children: true,
    archived: false,
    in_trash: false,
    type: 'toggle' as const,
    toggle: { rich_text: summary, color: 'default' as const },
  };
}

function paragraphChild(id: string, content: string) {
  return {
    object: 'block' as const,
    id,
    parent: { type: 'block_id' as const, block_id: 'summary-toggle' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user' as const, id: 'user-id' },
    last_edited_by: { object: 'user' as const, id: 'user-id' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'paragraph' as const,
    paragraph: { rich_text: [plainText(content)], color: 'default' as const },
  };
}

function linkParagraphChild(id: string, content: string, href: string) {
  return {
    object: 'block' as const,
    id,
    parent: { type: 'block_id' as const, block_id: 'summary-toggle' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user' as const, id: 'user-id' },
    last_edited_by: { object: 'user' as const, id: 'user-id' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'paragraph' as const,
    paragraph: {
      rich_text: [linkText(content, href)],
      color: 'default' as const,
    },
  };
}

class ChildStubApi extends MockNotionAPI {
  constructor(
    private readonly toggleId: string,
    private readonly children: unknown[]
  ) {
    super(process.env.NOTION_KEY!, '3');
  }

  async getBlocks(
    params: Parameters<MockNotionAPI['getBlocks']>[0]
  ): ReturnType<MockNotionAPI['getBlocks']> {
    const results = params.id === this.toggleId ? this.children : [];
    return {
      type: 'block',
      block: {},
      object: 'list',
      next_cursor: null,
      has_more: false,
      results,
    } as Awaited<ReturnType<MockNotionAPI['getBlocks']>>;
  }
}

async function runToggle(
  toggleId: string,
  summary: TestRichText[],
  children: unknown[],
  settings: CardOption = new CardOption({})
): Promise<Note[]> {
  const api = new ChildStubApi(toggleId, children);
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const bl = new BlockHandler(exporter, api, settings);
  return bl.getFlashcards(
    new ParserRules(),
    [toggleWithSummary(toggleId, summary)],
    [],
    undefined
  );
}

beforeEach(() => setupTests());

describe('link inside a toggle summary', () => {
  it('keeps the linked summary as the card front', async () => {
    const cards = await runToggle(
      'summary-toggle',
      [linkText('Source paper', 'https://example.com/paper')],
      [paragraphChild('answer-child', 'the answer')]
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain(
      '<a href="https://example.com/paper" target="_blank" rel="noopener noreferrer">Source paper</a>'
    );
    expect(cards[0].back).toContain('the answer');
  });

  it('shows only the link text on a plain-text back, not the url in brackets', async () => {
    const cards = await runToggle(
      'summary-toggle',
      [plainText('What is the source?')],
      [
        linkParagraphChild(
          'answer-child',
          'Source paper',
          'https://example.com/paper'
        ),
      ],
      new CardOption({ paragraph: 'true' })
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].back).toContain('Source paper');
    expect(cards[0].back).not.toContain('[https://example.com/paper]');
    expect(cards[0].back).not.toContain('<a');
  });
});

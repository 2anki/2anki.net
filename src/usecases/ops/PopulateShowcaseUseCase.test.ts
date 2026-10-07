import { vi } from 'vitest';
vi.mock('../../lib/storage/StorageHandler', () => {
  return {
    __esModule: true,
    default: vi.fn().mockImplementation(function () {
      return {};
    }),
  };
});

import { PopulateShowcaseUseCase } from './PopulateShowcaseUseCase';
import { InMemoryShowcaseRepository } from '../../data_layer/ShowcaseRepository';

const fakeBlock = (id: string, type = 'paragraph') => ({
  object: 'block' as const,
  id,
  type,
  has_children: false,
  created_time: '',
  last_edited_time: '',
  archived: false,
  in_trash: false,
  created_by: { object: 'user' as const, id: 'u1' },
  last_edited_by: { object: 'user' as const, id: 'u1' },
  parent: { type: 'page_id' as const, page_id: 'p1' },
  [type]: {
    rich_text: [
      {
        type: 'text' as const,
        text: { content: `Block ${id}`, link: null },
        plain_text: `Block ${id}`,
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default' as const,
        },
        href: null,
      },
    ],
  },
});

const fakeRenderedCard = (id: number) => ({
  id,
  ord: 0,
  templateName: 'Basic',
  deckName: 'Test',
  deckPath: ['Test'],
  noteTypeName: 'Basic',
  css: '',
  front: `<p>Front ${id}</p>`,
  back: `<p>Back ${id}</p>`,
});

function buildUseCase(
  overrides: {
    listBlocks?: () => Promise<unknown>;
    getPage?: () => Promise<unknown>;
    getFileBody?: () => Promise<unknown>;
    parseApkg?: () => Promise<unknown>;
    getCardsPage?: () => unknown;
  } = {}
) {
  const repo = new InMemoryShowcaseRepository();

  const mockApi = {
    listBlocksPage:
      overrides.listBlocks ??
      vi.fn().mockResolvedValue({
        results: [fakeBlock('b1'), fakeBlock('b2')],
        next_cursor: null,
        has_more: false,
      }),
    getPage:
      overrides.getPage ??
      vi.fn().mockResolvedValue({
        object: 'page',
        id: 'p1',
        url: 'https://notion.so/page',
        properties: {
          title: { type: 'title', title: [{ plain_text: 'Test Page' }] },
        },
      }),
  };

  const notionService = {
    getNotionAPI: vi.fn().mockResolvedValue(mockApi),
  } as any;

  const previewService = {
    parse:
      overrides.parseApkg ??
      vi.fn().mockResolvedValue({ collection: { cards: [] } }),
    getCardsPage:
      overrides.getCardsPage ??
      vi.fn().mockReturnValue({
        cards: [fakeRenderedCard(1), fakeRenderedCard(2)],
        nextCursor: null,
        total: 2,
      }),
  } as any;

  const downloadService = {
    getFileBody:
      overrides.getFileBody ??
      vi.fn().mockResolvedValue(Buffer.from('fake-apkg')),
  } as any;

  const useCase = new PopulateShowcaseUseCase(
    repo,
    notionService,
    previewService,
    downloadService
  );
  return { useCase, repo, notionService, downloadService, previewService };
}

describe('PopulateShowcaseUseCase', () => {
  it('fetches Notion blocks and APKG cards then stores them', async () => {
    const { useCase, repo } = buildUseCase();

    await useCase.execute('owner-1', 'page-id', 'file.apkg');

    const stored = await repo.get();
    expect(stored).not.toBeNull();
    expect(stored!.notionBlocks).toHaveLength(2);
    expect(stored!.ankiCards).toHaveLength(2);
    expect(stored!.populatedAt).toBeInstanceOf(Date);
  });

  it('throws when APKG file is not found', async () => {
    const { useCase } = buildUseCase({
      getFileBody: vi.fn().mockResolvedValue(null),
    });

    await expect(
      useCase.execute('owner-1', 'page-id', 'missing.apkg')
    ).rejects.toThrow('APKG file not found');
  });

  it('stores empty blocks when page has no content', async () => {
    const { useCase, repo } = buildUseCase({
      listBlocks: vi.fn().mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false,
      }),
    });

    await useCase.execute('owner-1', 'page-id', 'file.apkg');

    const stored = await repo.get();
    expect(stored!.notionBlocks).toHaveLength(0);
    expect(stored!.ankiCards).toHaveLength(2);
  });

  it('defaults page title to Untitled when lookup fails', async () => {
    const { useCase, repo } = buildUseCase({
      getPage: vi.fn().mockRejectedValue(new Error('not found')),
    });

    await useCase.execute('owner-1', 'page-id', 'file.apkg');

    const stored = await repo.get();
    expect(stored!.pageTitle).toBe('Untitled');
  });
});

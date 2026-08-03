import ResolveImportParentPageUseCase from './ResolveImportParentPageUseCase';
import NoNotionPagesError from './NoNotionPagesError';
import NotionAPIWrapper from '../../services/NotionService/NotionAPIWrapper';

function makeNotionApi(
  overrides: Partial<jest.Mocked<NotionAPIWrapper>> = {}
): jest.Mocked<NotionAPIWrapper> {
  return {
    searchTopLevelPages: jest.fn().mockResolvedValue({ results: [] }),
    createPage: jest.fn().mockResolvedValue({ id: 'new-page-id' }),
    ...overrides,
  } as unknown as jest.Mocked<NotionAPIWrapper>;
}

const IMPORT_PAGE_TITLE = '2anki Imports';

describe('ResolveImportParentPageUseCase', () => {
  let useCase: ResolveImportParentPageUseCase;

  beforeEach(() => {
    useCase = new ResolveImportParentPageUseCase();
  });

  it('returns the existing page when "2anki Imports" is found', async () => {
    const notionApi = makeNotionApi({
      searchTopLevelPages: jest.fn().mockResolvedValue({
        results: [
          {
            id: 'existing-imports-page',
            object: 'page',
            url: 'https://notion.so/existing',
            icon: null,
            title: IMPORT_PAGE_TITLE,
            parent: { type: 'workspace' },
          },
        ],
      }),
    });

    const pageId = await useCase.execute(notionApi);

    expect(pageId).toBe('existing-imports-page');
    expect(notionApi.createPage).not.toHaveBeenCalled();
  });

  it('creates "2anki Imports" under the first top-level page when not found', async () => {
    const notionApi = makeNotionApi({
      searchTopLevelPages: jest
        .fn()
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValueOnce({
          results: [
            {
              id: 'first-top-level-page',
              object: 'page',
              url: null,
              icon: null,
              title: 'My Workspace Page',
              parent: { type: 'workspace' },
            },
          ],
        }),
      createPage: jest.fn().mockResolvedValue({ id: 'created-page-id' }),
    });

    const pageId = await useCase.execute(notionApi);

    expect(pageId).toBe('created-page-id');
    expect(notionApi.createPage).toHaveBeenCalledWith(
      'first-top-level-page',
      IMPORT_PAGE_TITLE
    );
  });

  it('throws when no top-level pages are available to host the import page', async () => {
    const notionApi = makeNotionApi({
      searchTopLevelPages: jest.fn().mockResolvedValue({ results: [] }),
    });

    await expect(useCase.execute(notionApi)).rejects.toBeInstanceOf(
      NoNotionPagesError
    );
    await expect(useCase.execute(notionApi)).rejects.toThrow(
      'No Notion pages available'
    );
  });

  it('does not treat a partial title match as the import page', async () => {
    const searchMock = jest
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            id: 'some-other-page',
            object: 'page',
            url: null,
            icon: null,
            title: '2anki Imports Archive',
            parent: { type: 'workspace' },
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'some-other-page',
            object: 'page',
            url: null,
            icon: null,
            title: '2anki Imports Archive',
            parent: { type: 'workspace' },
          },
        ],
      });

    const notionApi = makeNotionApi({
      searchTopLevelPages: searchMock,
      createPage: jest.fn().mockResolvedValue({ id: 'new-imports-page' }),
    });

    const pageId = await useCase.execute(notionApi);

    expect(pageId).toBe('new-imports-page');
    expect(notionApi.createPage).toHaveBeenCalledWith(
      'some-other-page',
      IMPORT_PAGE_TITLE
    );
  });
});

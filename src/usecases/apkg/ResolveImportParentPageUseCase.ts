import NotionAPIWrapper from '../../services/NotionService/NotionAPIWrapper';
import NoNotionPagesError from './NoNotionPagesError';

const IMPORT_PAGE_TITLE = '2anki Imports';

export default class ResolveImportParentPageUseCase {
  async execute(notionApi: NotionAPIWrapper): Promise<string> {
    const existing = await this.findExistingImportPage(notionApi);
    if (existing != null) {
      return existing;
    }

    return this.createImportPage(notionApi);
  }

  private async findExistingImportPage(
    notionApi: NotionAPIWrapper
  ): Promise<string | null> {
    const searchResult = await notionApi.searchTopLevelPages(
      IMPORT_PAGE_TITLE,
      { maxResults: 10 }
    );

    const exactMatch = searchResult.results.find(
      (page) => page.title === IMPORT_PAGE_TITLE
    );
    return exactMatch?.id ?? null;
  }

  private async createImportPage(notionApi: NotionAPIWrapper): Promise<string> {
    const topPages = await notionApi.searchTopLevelPages('', {
      maxResults: 1,
    });

    if (topPages.results.length === 0) {
      throw new NoNotionPagesError();
    }

    const parentId = topPages.results[0].id;
    const created = await notionApi.createPage(parentId, IMPORT_PAGE_TITLE);
    return created.id;
  }
}

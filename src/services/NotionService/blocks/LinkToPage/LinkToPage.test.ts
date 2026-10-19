import { vi, type Mock } from 'vitest';
import { LinkToPageBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import LinkToPage from './LinkToPage';
import CardOption from '../../../../lib/parser/Settings';
import { stripLeadingDeckNumbering } from '../../../../lib/parser/helpers/stripLeadingDeckNumbering';
import type { IBlockRenderer } from '../../BlockHandler/types';

const LINKED_TITLE = '5. Love Languages';

function makeHandler(settings: CardOption): IBlockRenderer {
  return {
    settings,
    api: {
      getPage: vi.fn(async () => ({
        id: 'linked-page',
        object: 'page',
        properties: {},
      })),
      getPageTitle: vi.fn(async (_page: unknown, s: CardOption) =>
        s.removeDeckNameNumbering
          ? stripLeadingDeckNumbering(LINKED_TITLE)
          : LINKED_TITLE
      ),
    },
  } as unknown as IBlockRenderer;
}

function linkBlock(): LinkToPageBlockObjectResponse {
  return {
    object: 'block',
    id: 'link-1',
    type: 'link_to_page',
    link_to_page: { type: 'page_id', page_id: 'linked-page' },
  } as unknown as LinkToPageBlockObjectResponse;
}

describe('LinkToPage', () => {
  it('keeps the linked page number in the card link even when deck-name numbering is on', async () => {
    const handler = makeHandler(
      new CardOption({ 'remove-deck-name-numbering': 'true' })
    );
    const html = await LinkToPage(linkBlock(), handler);
    expect(html).toContain(LINKED_TITLE);
    const [, passedSettings] = (handler.api.getPageTitle as Mock).mock.calls[0];
    expect((passedSettings as CardOption).removeDeckNameNumbering).toBe(false);
  });
});

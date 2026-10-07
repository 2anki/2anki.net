import { vi, type Mock } from 'vitest';
import NotionAPIWrapper from './NotionAPIWrapper';
import CardOption from '../../lib/parser/Settings/CardOption';
import { GetPageResponse } from '@notionhq/client/build/src/api-endpoints';

vi.mock('get-notion-object-title', () => ({
  getNotionObjectTitle: vi.fn(),
}));

import { getNotionObjectTitle } from 'get-notion-object-title';

describe('NotionAPIWrapper.getPageTitle', () => {
  const settings = new CardOption({});

  function buildWrapper(): NotionAPIWrapper {
    return new NotionAPIWrapper('test-key', 'test-owner');
  }

  function makePage(): GetPageResponse {
    return {
      id: 'page-id',
      object: 'page',
      properties: {},
    } as unknown as GetPageResponse;
  }

  beforeEach(() => {
    (getNotionObjectTitle as Mock).mockReset();
  });

  it('returns empty string when page is null', async () => {
    const wrapper = buildWrapper();
    const title = await wrapper.getPageTitle(null, settings);
    expect(title).toBe('');
  });

  it('returns the page title when getNotionObjectTitle resolves a title', async () => {
    (getNotionObjectTitle as Mock).mockReturnValue('Influenza overview');
    const wrapper = buildWrapper();
    const title = await wrapper.getPageTitle(makePage(), settings);
    expect(title).toBe('Influenza overview');
  });

  it('returns the stable fallback "Untitled" when the page has no extractable title', async () => {
    (getNotionObjectTitle as Mock).mockReturnValue(undefined);
    const wrapper = buildWrapper();
    const title = await wrapper.getPageTitle(makePage(), settings);
    expect(title).toBe('Untitled');
  });

  it('does not embed a timestamp in the fallback title', async () => {
    (getNotionObjectTitle as Mock).mockReturnValue(undefined);
    const wrapper = buildWrapper();
    const title = await wrapper.getPageTitle(makePage(), settings);
    expect(title).not.toMatch(/\d{4}/);
    expect(title.toLowerCase()).not.toContain('gmt');
  });
});

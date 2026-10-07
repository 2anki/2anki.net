import { vi } from 'vitest';
import BlockHandler from '../BlockHandler';
import NotionAPIWrapper from '../../NotionAPIWrapper';
import CustomExporter from '../../../../lib/parser/exporters/CustomExporter';
import CardOption from '../../../../lib/parser/Settings';
import ParserRules from '../../../../lib/parser/ParserRules';
import { ISettingsRepository } from '../../../../data_layer/SettingsRepository';

vi.mock('../../../../lib/parser/exporters/CustomExporter');

interface FakePage {
  id: string;
  created_time: string;
  last_edited_time: string;
  childPageIds: string[];
}

function buildPage(id: string, childPageIds: string[] = []): FakePage {
  return {
    id,
    created_time: '2026-01-01T00:00:00.000Z',
    last_edited_time: '2026-01-01T00:00:00.000Z',
    childPageIds,
  };
}

function buildApi(
  pages: Record<string, FakePage>,
  titles: Record<string, string>
): NotionAPIWrapper {
  const api = {
    getPage: vi.fn(async (id: string) => pages[id]),
    getTopLevelTags: vi.fn(async () => []),
    getBlocks: vi.fn(async ({ id }: { id: string }) => ({
      results: pages[id].childPageIds.map((childId) => ({
        object: 'block',
        id: childId,
        type: 'child_page',
        has_children: true,
        child_page: { title: titles[childId] ?? childId },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:00:00.000Z',
      })),
    })),
    getPageTitle: vi.fn(async (page: FakePage, settings?: CardOption) => {
      if (settings?.deckName) {
        return settings.deckName;
      }
      return titles[page.id] ?? page.id;
    }),
  };
  return api as unknown as NotionAPIWrapper;
}

function buildSettings(deckName?: string): CardOption {
  return new CardOption({
    ...CardOption.LoadDefaultOptions(),
    ...(deckName ? { deckName } : {}),
  });
}

function buildSettingsRepository(
  rows: Record<string, CardOption>
): ISettingsRepository {
  return {
    load: vi.fn(async () => buildSettings()),
    loadIfExists: vi.fn(async (_owner: string, id: string) => rows[id] ?? null),
    loadAnkifyTemplateOverrides: vi.fn(async () => null),
    attachCustomTemplates: vi.fn(async () => undefined),
  };
}

const OWNER = 'owner-1';

function newHandler(
  api: NotionAPIWrapper,
  parentSettings: CardOption,
  repo: ISettingsRepository
): BlockHandler {
  const exporter = new CustomExporter('', '/tmp');
  return new BlockHandler(exporter, api, parentSettings, repo, OWNER);
}

describe('findFlashcardsFromPage per-page settings', () => {
  it('uses the child page own deck name when it has a settings row', async () => {
    const pages = {
      parent: buildPage('parent', ['child']),
      child: buildPage('child'),
    };
    const titles = { parent: 'Parent title', child: 'Child title' };
    const api = buildApi(pages, titles);
    const parentSettings = buildSettings('A');
    const repo = buildSettingsRepository({ child: buildSettings('B') });
    const handler = newHandler(api, parentSettings, repo);

    const decks = await handler.findFlashcardsFromPage({
      parentType: 'page',
      topLevelId: 'parent',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const names = decks.map((d) => d.name);
    expect(names).toContain('A');
    expect(names).toContain('A::B');
  });

  it('inherits the parent settings when the child has no settings row', async () => {
    const pages = {
      parent: buildPage('parent', ['child']),
      child: buildPage('child'),
    };
    const titles = { parent: 'Parent title', child: 'Child title' };
    const api = buildApi(pages, titles);
    const parentSettings = buildSettings();
    const repo = buildSettingsRepository({});
    const handler = newHandler(api, parentSettings, repo);

    const decks = await handler.findFlashcardsFromPage({
      parentType: 'page',
      topLevelId: 'parent',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const names = decks.map((d) => d.name);
    expect(names).toContain('Parent title');
    expect(names).toContain('Parent title::Child title');
  });

  it('inherits the nearest ancestor with a row for a grandchild without one', async () => {
    const pages = {
      parent: buildPage('parent', ['child']),
      child: buildPage('child', ['grandchild']),
      grandchild: buildPage('grandchild'),
    };
    const titles = {
      parent: 'Parent title',
      child: 'Child title',
      grandchild: 'Grandchild title',
    };
    const api = buildApi(pages, titles);
    const parentSettings = buildSettings('A');
    const repo = buildSettingsRepository({ child: buildSettings('B') });
    const handler = newHandler(api, parentSettings, repo);

    const decks = await handler.findFlashcardsFromPage({
      parentType: 'page',
      topLevelId: 'parent',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const names = decks.map((d) => d.name);
    expect(names).toContain('A');
    expect(names).toContain('A::B');
    expect(names).toContain('A::B::B');
  });
});

import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import Deck from '../../../lib/parser/Deck';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

interface FakeApiOpts {
  rowCount: number;
}

function makeApi(opts: FakeApiOpts): NotionAPIWrapper {
  const results = Array.from({ length: opts.rowCount }, (_, i) => ({
    id: `row-${i}`,
    object: 'page',
    created_time: '2024-01-01T00:00:00.000Z',
    last_edited_time: '2024-01-01T00:00:00.000Z',
    properties: {},
  }));

  return {
    queryDatabase: vi.fn().mockResolvedValue({ results }),
    getDatabase: vi.fn().mockResolvedValue({ id: 'embedded-db' }),
    getDatabaseTitle: vi.fn().mockResolvedValue('Embedded DB'),
    getPage: vi.fn().mockResolvedValue({
      id: 'page',
      object: 'page',
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: '2024-01-01T00:00:00.000Z',
      properties: {},
    }),
    getPageTitle: vi.fn().mockResolvedValue('Row'),
    getTopLevelTags: vi.fn().mockResolvedValue([]),
    getBlocks: vi.fn().mockResolvedValue({ results: [] }),
  } as unknown as NotionAPIWrapper;
}

function makeHandler(api: NotionAPIWrapper): BlockHandler {
  const settings = new CardOption({});
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  return new BlockHandler(exporter, api, settings);
}

type WithPrivateHandleChildDatabase = {
  handleChildDatabase: (
    sd: { id: string },
    rules: ParserRules
  ) => Promise<Deck[]>;
};

describe('BlockHandler.handleChildDatabase', () => {
  it('passes all=true to queryDatabase so embedded databases paginate fully', async () => {
    const api = makeApi({ rowCount: 1 });
    const handler = makeHandler(api);

    await (
      handler as unknown as WithPrivateHandleChildDatabase
    ).handleChildDatabase({ id: 'embedded-db' }, new ParserRules());

    expect(api.queryDatabase).toHaveBeenCalledWith('embedded-db', true);
  });

  it('processes every row returned, not just the first page', async () => {
    const api = makeApi({ rowCount: 250 });
    const handler = makeHandler(api);

    const decks = await (
      handler as unknown as WithPrivateHandleChildDatabase
    ).handleChildDatabase({ id: 'embedded-db' }, new ParserRules());

    expect(api.getPage).toHaveBeenCalledTimes(250);
    expect(decks.length).toBeGreaterThanOrEqual(250);
  });
});

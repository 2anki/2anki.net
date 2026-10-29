import { vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const generateDeckInfoMock = vi.hoisted(() =>
  vi.fn<typeof import('../../claude/ClaudeService').generateDeckInfo>()
);

vi.mock('../../claude/ClaudeService', async (importActual) => {
  const actual =
    await importActual<typeof import('../../claude/ClaudeService')>();
  return { ...actual, generateDeckInfo: generateDeckInfoMock };
});

import { setupTests } from '../../../test/configure-jest';
import CardOption from '../Settings';
import Note from '../Note';
import Workspace from '../WorkSpace';
import { DeckParser } from '../DeckParser';
import CustomExporter from '../exporters/CustomExporter';
import ParserRules from '../ParserRules';
import { buildDeckStyle } from '../buildDeckStyle';
import { expandCompactDeckInfo } from '../../claude/ClaudeService';
import BlockHandler from '../../../services/NotionService/BlockHandler/BlockHandler';
import type NotionAPIWrapper from '../../../services/NotionService/NotionAPIWrapper';
import { buildSubdeckDecks } from '../../../services/mcp/buildSubdeckDecks';
import { buildMindmapDeckInfo } from '../../../usecases/mindmaps/buildMindmapDeckInfo';
import { buildVocabDeckFromKindleClippings } from '../../../usecases/uploads/BuildVocabDeckUseCase';
import { PrepareDeck } from '../../../infrastracture/adapters/fileConversion/PrepareDeck';

interface DeckInfoEntry {
  style?: string | null;
  settings?: Record<string, unknown>;
}

type SettingsInput = Record<string, string>;

const NOTION_HTML = fs
  .readFileSync(
    path.join(
      __dirname,
      '../../../test/fixtures/Colours 0519bf7e86d84ee4ba710c1b7ff7438e.html'
    )
  )
  .toString();

const KINDLE_CLIPPINGS = [
  'Sapiens (Yuval Noah Harari)',
  '- Your Highlight on page 23 | Location 156-158 | Added on Friday, January 1, 2021 12:00:00 PM',
  '',
  'Cognitive revolution was a turning point.',
  '==========',
].join('\n');

function readDeckInfo(workspace: Workspace): DeckInfoEntry[] {
  return JSON.parse(
    fs.readFileSync(path.join(workspace.location, 'deck_info.json'), 'utf8')
  ) as DeckInfoEntry[];
}

function asDeckInfo(decks: unknown): DeckInfoEntry[] {
  return JSON.parse(JSON.stringify(decks)) as DeckInfoEntry[];
}

async function uploadedFile(
  name: string,
  contents: string,
  input: SettingsInput
): Promise<DeckInfoEntry[]> {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name,
    settings: new CardOption(input),
    files: [{ name, contents }],
    noLimits: true,
    workspace,
  });
  if (parser.totalCardCount() === 0) {
    await parser.tryExperimental();
  } else {
    await parser.build(workspace);
  }
  return readDeckInfo(workspace);
}

function notionApi(): NotionAPIWrapper {
  const time = '2026-01-01T00:00:00.000Z';
  const richText = (content: string) => [
    {
      type: 'text',
      text: { content, link: null },
      plain_text: content,
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
    },
  ];
  const block = (id: string, type: string, hasChildren: boolean) => ({
    object: 'block',
    id,
    type,
    has_children: hasChildren,
    created_time: time,
    last_edited_time: time,
    archived: false,
    in_trash: false,
    parent: { type: 'page_id', page_id: 'page-1' },
  });
  const children: Record<string, unknown[]> = {
    'page-1': [
      {
        ...block('t1', 'toggle', true),
        toggle: { rich_text: richText('Front'), color: 'default' },
      },
    ],
    t1: [
      {
        ...block('b1', 'bulleted_list_item', false),
        bulleted_list_item: { rich_text: richText('Back'), color: 'default' },
      },
    ],
  };
  return {
    getPage: () =>
      Promise.resolve({
        id: 'page-1',
        object: 'page',
        created_time: time,
        last_edited_time: time,
        url: 'https://notion.so/page-1',
        properties: {},
      }),
    getPageTitle: () => Promise.resolve('Notion page'),
    getTopLevelTags: () => Promise.resolve([]),
    getBlocks: ({ id }: { id: string }) =>
      Promise.resolve({ results: children[id] ?? [], has_more: false }),
  } as unknown as NotionAPIWrapper;
}

const settingsPaths: [
  string,
  (input: SettingsInput) => Promise<DeckInfoEntry[]>,
][] = [
  [
    'Notion HTML export',
    (input) => uploadedFile('Colours.html', NOTION_HTML, input),
  ],
  [
    'Markdown with nested bullets',
    (input) =>
      uploadedFile('notes.md', '- Question\n  - Answer\n', {
        ...input,
        'markdown-nested-bullet-points': 'true',
      }),
  ],
  [
    'txt',
    (input) =>
      uploadedFile('notes.txt', 'Question - Answer\nSecond - More\n', input),
  ],
  [
    'csv',
    (input) =>
      uploadedFile('notes.csv', 'Question,Answer\nSecond,More\n', input),
  ],
  [
    'Notion-connected page',
    async (input) => {
      const exporter = new CustomExporter(
        '',
        new Workspace(true, 'fs').location
      );
      const handler = new BlockHandler(
        exporter,
        notionApi(),
        new CardOption(input)
      );
      return asDeckInfo(
        await handler.findFlashcards({
          parentType: 'page',
          topLevelId: 'page-1',
          rules: new ParserRules(),
          decks: [],
          parentName: '',
        })
      );
    },
  ],
  [
    'Kindle vocab',
    async (input) => {
      const result = await buildVocabDeckFromKindleClippings({
        file: {
          name: 'My Clippings.txt',
          contents: Buffer.from(KINDLE_CLIPPINGS),
        },
        settings: new CardOption(input),
        workspace: new Workspace(true, 'fs'),
      });
      return JSON.parse(result.apkg.toString('utf8')) as DeckInfoEntry[];
    },
  ],
  [
    'AI conversion',
    async (input) => {
      generateDeckInfoMock.mockResolvedValueOnce(
        expandCompactDeckInfo(
          [{ deck: 'AI deck', cards: [{ q: 'Question', a: 'Answer' }] }],
          [],
          '.page-own-style { color: red; }'
        )
      );
      const workspace = new Workspace(true, 'fs');
      await PrepareDeck({
        name: 'ai.html',
        files: [{ name: 'ai.html', contents: Buffer.from(NOTION_HTML) }],
        settings: new CardOption({ ...input, 'claude-ai-flashcards': 'true' }),
        noLimits: true,
        workspace,
        userId: null,
      });
      expect(generateDeckInfoMock).toHaveBeenCalledTimes(1);
      return readDeckInfo(workspace);
    },
  ],
];

const settingsFreePaths: [string, () => Promise<DeckInfoEntry[]>][] = [
  [
    'MCP subdecks',
    () =>
      Promise.resolve(
        asDeckInfo(
          buildSubdeckDecks([
            {
              deck: 'MCP deck',
              cards: [{ front: 'Question', back: 'Answer' }],
            },
          ])
        )
      ),
  ],
  [
    'mind map',
    () =>
      Promise.resolve(
        asDeckInfo(
          buildMindmapDeckInfo('Mind map', [new Note('Question', 'Answer')])
        )
      ),
  ],
];

function noteTypeShape(deck: DeckInfoEntry) {
  const settings = deck.settings ?? {};
  return {
    template: settings.template ?? 'specialstyle',
    basicModelName: settings.basicModelName ?? 'n2a-basic',
    clozeModelName: settings.clozeModelName ?? 'n2a-cloze',
    inputModelName: settings.inputModelName ?? 'n2a-input',
    basicModelId: settings.basicModelId ?? null,
    clozeModelId: settings.clozeModelId ?? null,
    inputModelId: settings.inputModelId ?? null,
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function pinnedNotetypeMod(): string {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../../create_deck/helpers/n2a_model.py'),
    'utf8'
  );
  return /^NOTETYPE_MOD = (\d+)$/m.exec(source)?.[1] ?? 'missing';
}

const DEFAULT_SETTINGS: SettingsInput = {};
const STYLED_SETTINGS: SettingsInput = {
  'font-size': '28',
  'text-color': '#1f2937',
  'text-align': 'center',
  'code-theme': 'dracula',
  'style-changed-at': '1793000000',
};

const originalSkipCreateDeck = process.env.SKIP_CREATE_DECK;

beforeAll(() => {
  process.env.SKIP_CREATE_DECK = 'true';
});

afterAll(() => {
  if (originalSkipCreateDeck == null) {
    delete process.env.SKIP_CREATE_DECK;
  } else {
    process.env.SKIP_CREATE_DECK = originalSkipCreateDeck;
  }
});

beforeEach(() => {
  setupTests();
  generateDeckInfoMock.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1793275200 * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('one note-type style for every deck-building path', () => {
  describe.each([
    ['default settings', DEFAULT_SETTINGS],
    ['custom font, colour, alignment and code theme', STYLED_SETTINGS],
  ])('with %s', (_label, input) => {
    const expected = buildDeckStyle(new CardOption(input));

    it.each(settingsPaths)(
      '%s writes the shared style and note-type shape',
      async (_path, build) => {
        const decks = await build(input);
        expect(decks.length).toBeGreaterThan(0);
        for (const deck of decks) {
          expect(deck.style).toBe(expected);
        }
        expect(noteTypeShape(decks[0])).toEqual(
          noteTypeShape({ settings: {} })
        );
        expect(decks[0].settings?.styleChangedAt).toBe(
          input['style-changed-at'] == null ? 0 : 1793000000
        );
      }
    );
  });

  it.each(settingsFreePaths)(
    '%s writes the default style and note-type shape',
    async (_path, build) => {
      const decks = await build();
      for (const deck of decks) {
        expect(deck.style).toBe(buildDeckStyle(new CardOption({})));
      }
      expect(noteTypeShape(decks[0])).toEqual(noteTypeShape({ settings: {} }));
    }
  );

  it('pins the default note-type CSS to the shipped NOTETYPE_MOD', () => {
    const css = buildDeckStyle(new CardOption({}));
    expect({
      cssSha256: sha256(css),
      cssBytes: css.length,
      notetypeMod: pinnedNotetypeMod(),
    }).toMatchSnapshot();
  });
});

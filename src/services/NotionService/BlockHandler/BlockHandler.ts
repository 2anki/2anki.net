import { isFullBlock, isFullPage } from '@notionhq/client';
import {
  AudioBlockObjectResponse,
  BlockObjectResponse,
  FileBlockObjectResponse,
  GetBlockResponse,
  ImageBlockObjectResponse,
  ListBlockChildrenResponse,
  PageObjectResponse,
  PdfBlockObjectResponse,
  TableBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

import getDeckName from '../../../lib/anki/getDeckname';
import { inferColumnMapping } from '../../../lib/notionDatabase/inferColumnMapping';
import sanitizeTags from '../../../lib/anki/sanitizeTags';
import { S3FileName, SuffixFrom } from '../../../lib/misc/file';
import getUniqueFileName from '../../../lib/misc/getUniqueFileName';
import Deck from '../../../lib/parser/Deck';
import { detectNotionApiMCQ } from '../../../lib/parser/findNotionToggleLists';
import Note from '../../../lib/parser/Note';
import { countEmptyBacks } from '../../../lib/parser/countEmptyBacks';
import ParserRules from '../../../lib/parser/ParserRules';
import CardOption from '../../../lib/parser/Settings';
import TagRegistry from '../../../lib/parser/TagRegistry';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import { withFontSize } from '../../../lib/parser/withFontSize';
import { withTextColor } from '../../../lib/parser/withTextColor';
import { withTextAlign } from '../../../lib/parser/withTextAlign';
import get16DigitRandomId from '../../../shared/helpers/get16DigitRandomId';
import { NOTION_STYLE, getCodeThemeCss } from '../../../templates/helper';
import NotionAPIWrapper from '../NotionAPIWrapper';
import type { IBlockRenderer } from './types';
import BlockColumn from '../blocks/lists/BlockColumn';
import { tableRowsToCards } from '../blocks/lists/BlockTable';
import { blockToStaticMarkup } from '../helpers/blockToStaticMarkup';
import { getToggleSummaryRichText } from '../helpers/getToggleSummaryRichText';
import { isToggleHeading } from '../helpers/isToggleHeading';
import { classifyBlock } from '../../../lib/parser/intent/classifyBlock';
import {
  buildHeadingContextMap,
  buildHeadingTagMap,
  HeadingContext,
} from './helpers/buildHeadingTagMap';
import {
  blocksPlainTextLength,
  induceNotesFromBlocks,
  NOTION_CANDIDATE_RULES,
} from './helpers/induceNotesFromBlocks';
import {
  InducedRescue,
  InducedRule,
  mergeInducedRescue,
} from '../../../lib/parser/induction/candidateRules';
import { runInduction } from '../../../lib/parser/induction/rankCandidates';
import { scoreCandidateDeck } from '../../../lib/parser/scoreCandidateDeck';
import {
  ConversionTruncation,
  hasRuleBasedSubDecks,
  isTruncatedBlockFetch,
} from '../helpers/conversionTruncation';
import { downloadWithFreshUrlRetry } from '../helpers/downloadWithFreshUrlRetry';
import { expandSyncedBlocks } from '../helpers/expandSyncedBlocks';
import { getAudioSourceType, getAudioUrl } from '../helpers/getAudioUrl';
import getClozeDeletionCard from '../helpers/getClozeDeletionCard';
import handleClozeDeletions from '../../../lib/parser/helpers/handleClozeDeletions';
import hasInlineClozeCode from '../../../lib/parser/helpers/hasInlineClozeCode';
import getColumn from '../helpers/getColumn';
import { getFileSourceType, getFileUrl } from '../helpers/getFileUrl';
import { getImageSourceType, getImageUrl } from '../helpers/getImageUrl';
import { isNotionDatabaseNotPageError } from '../helpers/isNotionDatabaseNotPageError';
import getInputCard from '../helpers/getInputCard';
import isColumnList from '../helpers/isColumnList';
import isTesting from '../helpers/isTesting';
import perserveNewlinesIfApplicable from '../helpers/preserveNewlinesIfApplicable';
import { renderBack } from '../helpers/renderBack';
import renderTextChildren from '../helpers/renderTextChildren';
import { toText } from './helpers/deckNameToText';
import getSubDeckName from './helpers/getSubDeckName';
import mergeChildPageSettings from './helpers/mergeChildPageSettings';
import RenderNotionLink from './RenderNotionLink';
import { ISettingsRepository } from '../../../data_layer/SettingsRepository';

interface Finder {
  parentType: string;
  topLevelId: string;
  rules: ParserRules;
  decks: Deck[];
  parentName: string;
  frontField?: string;
  backField?: string;
}

const PAGE_LIKE_DECK_TYPES = new Set([
  'page',
  'database',
  'child_page',
  'child_database',
]);

function activeNonPageDeckTypes(rules: ParserRules): Set<string> {
  return new Set(
    rules.deckTypes().filter((type) => !PAGE_LIKE_DECK_TYPES.has(type))
  );
}

interface PlainTextItem {
  plain_text?: string;
}

function joinPlainText(items: PlainTextItem[]): string {
  return items
    .map((t) => t.plain_text ?? '')
    .filter((t) => t.length > 0)
    .join('<br>');
}

function extractRowText(property: unknown): string {
  if (property == null || typeof property !== 'object') return '';
  const p = property as {
    type?: string;
    title?: PlainTextItem[];
    rich_text?: PlainTextItem[];
  };
  if (p.type === 'title' && Array.isArray(p.title))
    return joinPlainText(p.title);
  if (p.type === 'rich_text' && Array.isArray(p.rich_text))
    return joinPlainText(p.rich_text);
  return '';
}

function notesFromRows(
  rows: unknown[],
  frontField: string,
  backField: string
): Note[] {
  return rows
    .map((row) => {
      const properties = (row as { properties?: Record<string, unknown> })
        .properties;
      if (properties == null) return null;
      const front = extractRowText(properties[frontField]);
      const back = extractRowText(properties[backField]);
      if (front === '' || back === '') return null;
      return new Note(front, back);
    })
    .filter((note): note is Note => note != null);
}

function orderedColumnPairs(
  columnNames: string[],
  triedFront: string,
  triedBack: string
): { frontField: string; backField: string }[] {
  const pairs: { frontField: string; backField: string }[] = [];
  for (const frontField of columnNames) {
    for (const backField of columnNames) {
      if (frontField === backField) continue;
      if (frontField === triedFront && backField === triedBack) continue;
      pairs.push({ frontField, backField });
    }
  }
  return pairs;
}

function headingTagsFor(
  blockId: string,
  headingTagMap: Map<string, string>
): string[] {
  const tag = headingTagMap.get(blockId);
  return tag ? [tag] : [];
}

function asPlainHeading(block: BlockObjectResponse): BlockObjectResponse {
  switch (block.type) {
    case 'heading_1':
      return {
        ...block,
        heading_1: { ...block.heading_1, is_toggleable: false },
      };
    case 'heading_2':
      return {
        ...block,
        heading_2: { ...block.heading_2, is_toggleable: false },
      };
    case 'heading_3':
      return {
        ...block,
        heading_3: { ...block.heading_3, is_toggleable: false },
      };
    case 'heading_4':
      return {
        ...block,
        heading_4: { ...block.heading_4, is_toggleable: false },
      };
    default:
      return block;
  }
}

function applyHierarchyFields(
  ankiNote: Note,
  blockId: string,
  headingContextMap: Map<string, HeadingContext>
): void {
  const context = headingContextMap.get(blockId);
  ankiNote.hierarchy = true;
  ankiNote.h1 = context?.h1 ?? '';
  ankiNote.h2 = context?.h2 ?? '';
  ankiNote.h3 = context?.h3 ?? '';
}

class BlockHandler implements IBlockRenderer {
  api: NotionAPIWrapper;

  exporter;

  skip: string[];

  firstPageTitle?: string;

  useAll: boolean = false;

  truncation?: ConversionTruncation;

  guessedColumnMapping?: { frontField: string; backField: string };

  inducedRule?: InducedRescue;

  resolvedDatabasePath?: { viaPageLinkSelfHeal: boolean };

  droppedAssetCount = 0;

  emptyBackCount = 0;

  cardCount = 0;

  blocksSeen = 0;

  unsupportedBlockTypeCounts: Map<string, number> = new Map();

  get unsupportedBlockTypes(): string[] {
    const types: string[] = [];
    for (const [type, count] of this.unsupportedBlockTypeCounts) {
      for (let occurrence = 0; occurrence < count; occurrence += 1) {
        types.push(type);
      }
    }
    return types;
  }

  settings: CardOption;

  settingsRepository?: ISettingsRepository;

  owner?: string;

  tagRegistry: TagRegistry;

  constructor(
    exporter: CustomExporter,
    api: NotionAPIWrapper,
    settings: CardOption,
    settingsRepository?: ISettingsRepository,
    owner?: string
  ) {
    this.exporter = exporter;
    this.api = api;
    this.skip = [];
    this.settings = settings;
    this.settingsRepository = settingsRepository;
    this.owner = owner;
    this.tagRegistry = new TagRegistry();
  }

  private buildDeckStyle(): string {
    const themed = `${NOTION_STYLE}\n${getCodeThemeCss(this.settings.codeTheme)}`;
    return (
      withTextAlign(
        withTextColor(
          withFontSize(themed, this.settings.fontSize),
          this.settings.textColor
        ),
        this.settings.textAlign
      ) ?? themed
    );
  }

  private async resolvePageSettings(pageId: string): Promise<CardOption> {
    if (!this.settingsRepository || this.owner == null) {
      return this.settings;
    }
    const childSettings = await this.settingsRepository.loadIfExists(
      this.owner,
      pageId
    );
    if (!childSettings) {
      return this.settings;
    }
    return mergeChildPageSettings(this.settings, childSettings);
  }

  async embedImage(c: BlockObjectResponse): Promise<string> {
    const image = c as ImageBlockObjectResponse;
    const url = getImageUrl(image);
    if (
      !this.settings.embedImages ||
      this.settings.isTextOnlyBack ||
      isTesting() ||
      !url
    ) {
      return '';
    }

    const suffix = SuffixFrom(S3FileName(url));
    const newName = getUniqueFileName(url) + (suffix ?? '');
    const contents = await downloadWithFreshUrlRetry({
      api: this.api,
      blockId: image.id,
      url,
      sourceType: getImageSourceType(image),
      extractFreshUrl: (fresh) =>
        getImageUrl(fresh as ImageBlockObjectResponse),
    });
    if (contents == null) {
      this.droppedAssetCount += 1;
      return '';
    }
    this.exporter.addMedia(newName, contents);
    return `<img src="${newName}" />`;
  }

  async embedAudioFile(c: AudioBlockObjectResponse): Promise<string> {
    const url = getAudioUrl(c);
    if (this.settings.isTextOnlyBack || isTesting() || !url) {
      return '';
    }
    const newName = getUniqueFileName(url);

    const contents = await downloadWithFreshUrlRetry({
      api: this.api,
      blockId: c.id,
      url,
      sourceType: getAudioSourceType(c),
      extractFreshUrl: (fresh) =>
        getAudioUrl(fresh as AudioBlockObjectResponse),
    });
    if (contents == null) {
      this.droppedAssetCount += 1;
      return '';
    }
    this.exporter.addMedia(newName, contents);
    return `[sound:${newName}]`;
  }

  async embedFile(
    block: FileBlockObjectResponse | PdfBlockObjectResponse
  ): Promise<string> {
    const url = getFileUrl(block);
    if (this.settings.isTextOnlyBack || isTesting() || !url) {
      return '';
    }
    const newName = getUniqueFileName(url);
    const contents = await downloadWithFreshUrlRetry({
      api: this.api,
      blockId: block.id,
      url,
      sourceType: getFileSourceType(block),
      extractFreshUrl: (fresh) =>
        getFileUrl(fresh as FileBlockObjectResponse | PdfBlockObjectResponse),
    });
    if (contents == null) {
      this.droppedAssetCount += 1;
      return '';
    }
    this.exporter.addMedia(newName, contents);
    return `<embed src="${newName}" />`;
  }

  async getToggleFrontMedia(block: BlockObjectResponse): Promise<string> {
    const children = await this.api.getBlocks({
      createdAt: block.created_time,
      lastEditedAt: block.last_edited_time,
      id: block.id,
      all: this.useAll,
      type: block.type,
    });
    const first = children.results[0];
    if (first == null || !isFullBlock(first)) {
      return '';
    }
    if (first.type === 'image' || first.type === 'audio') {
      return blockToStaticMarkup(this, first);
    }
    return '';
  }

  /**
   * Retrieve the back side of a toggle
   * @param block
   * @param handleChildren
   * @returns
   */
  async getBackSide(
    block: BlockObjectResponse,
    handleChildren?: boolean
  ): Promise<string | null> {
    let response2: ListBlockChildrenResponse | null;
    try {
      response2 = await this.api.getBlocks({
        createdAt: block.created_time,
        lastEditedAt: block.last_edited_time,
        id: block.id,
        all: this.useAll,
        type: block.type,
      });
      const requestChildren = await expandSyncedBlocks(
        response2.results,
        this.api,
        this.useAll
      );
      return await renderBack(this, requestChildren, response2, handleChildren);
    } catch (e: unknown) {
      console.info('Get back side failed');
      console.error(e);
      return null;
    }
  }

  __notionLink(
    id: string,
    notionBaseLink: string | undefined
  ): string | undefined {
    return notionBaseLink
      ? `${notionBaseLink}#${id.replace(/-/g, '')}`
      : undefined;
  }

  recordUnsupportedBlockType(type: string): void {
    this.unsupportedBlockTypeCounts.set(
      type,
      (this.unsupportedBlockTypeCounts.get(type) ?? 0) + 1
    );
  }

  async getFlashcards(
    rules: ParserRules,
    flashcardBlocks: GetBlockResponse[],
    tags: string[],
    notionBaseLink: string | undefined,
    headingTagMap: Map<string, string> = new Map(),
    headingContextMap: Map<string, HeadingContext> = new Map()
  ): Promise<Note[]> {
    const hierarchyEnabled = this.settings.template === 'hierarchy';
    let cards = [];
    let counter = 0;

    for (const block of flashcardBlocks) {
      this.blocksSeen += 1;
      if (isFullBlock(block) && block.type === 'table') {
        const tableBlock = block as TableBlockObjectResponse;
        const tableChildren = await this.api.getBlocks({
          createdAt: tableBlock.created_time,
          lastEditedAt: tableBlock.last_edited_time,
          id: tableBlock.id,
          all: this.useAll,
          type: tableBlock.type,
        });
        const tableCards = tableRowsToCards(tableBlock, tableChildren, this);
        for (const { front, back: tableBack, isCloze } of tableCards) {
          const ankiNote = new Note(front, tableBack);
          ankiNote.cloze = isCloze;
          ankiNote.media = this.exporter.media;
          ankiNote.notionLink = this.__notionLink(
            tableBlock.id,
            notionBaseLink
          );
          ankiNote.notionId = this.settings.useNotionId
            ? tableBlock.id
            : undefined;
          ankiNote.tags =
            rules.TAGS === 'heading'
              ? headingTagsFor(tableBlock.id, headingTagMap)
              : this.tagRegistry.strikethroughs;
          ankiNote.number = counter++;
          if (hierarchyEnabled) {
            applyHierarchyFields(ankiNote, tableBlock.id, headingContextMap);
          }
          cards.push(ankiNote);
        }
        this.tagRegistry.clear();
        continue;
      }

      let name: string;
      let back: null | string = '';

      const fullBlock = isFullBlock(block) ? block : null;
      const toggleSummary = fullBlock
        ? getToggleSummaryRichText(fullBlock)
        : null;
      if (fullBlock && toggleSummary) {
        // Always preserve newlines in toggle summaries by converting \n to <br />
        name = renderTextChildren(
          toggleSummary,
          this.settings,
          this.tagRegistry
        ).replaceAll('\n', '<br />');
        if (!name) {
          name = await this.getToggleFrontMedia(fullBlock);
        }
        back = await this.getBackSide(fullBlock);
      } else {
        // For non-toggle blocks, use the existing logic
        name = await blockToStaticMarkup(this, block as BlockObjectResponse);

        if (isColumnList(block) && rules.useColums()) {
          const secondColumn = await getColumn(block.id, this, 1);
          if (secondColumn) {
            back = await BlockColumn(secondColumn, this);
          }
        } else {
          back = await this.getBackSide(block as BlockObjectResponse);
        }
      }

      if (!name) {
        console.debug('name is not valid for front, skipping', name, back);
        continue;
      }

      const ankiNote = new Note(name, back ?? '');
      ankiNote.media = this.exporter.media;
      let isBasicType = true;
      if (this.settings.mcqEnabled && back) {
        const mcq = detectNotionApiMCQ(back);
        if (mcq.isMcqShape && mcq.correctIndex >= 0) {
          isBasicType = false;
          ankiNote.mcq = true;
          ankiNote.options = mcq.options;
          ankiNote.correctIndices = [mcq.correctIndex];
          ankiNote.back = '';
        }
      }
      // Look for cloze deletion cards
      if (!ankiNote.mcq && this.settings.isCloze) {
        const clozeCard = getClozeDeletionCard(block);
        if (clozeCard) {
          isBasicType = false;
          ankiNote.copyValues(clozeCard);
        } else if (
          back &&
          this.settings.clozeFromToggleContent &&
          hasInlineClozeCode(back)
        ) {
          isBasicType = false;
          ankiNote.cloze = true;
          ankiNote.name = handleClozeDeletions(back);
          ankiNote.back = name;
          back = name;
        }
      }
      // Look for input cards
      if (!ankiNote.mcq && this.settings.useInput) {
        const inputCard = getInputCard(rules, block);
        if (inputCard) {
          isBasicType = false;
          ankiNote.copyValues(inputCard);
        }
      }

      if (!ankiNote.mcq) {
        ankiNote.back = back || '';
      }
      ankiNote.notionLink = this.__notionLink(block.id, notionBaseLink);
      if (this.settings.addNotionLink && !ankiNote.mcq) {
        ankiNote.back += RenderNotionLink(ankiNote.notionLink!, this);
      }
      ankiNote.notionId = block.id;
      ankiNote.media = this.exporter.media;
      this.exporter.media = [];

      const tr = this.tagRegistry;
      ankiNote.tags =
        rules.TAGS === 'heading'
          ? headingTagsFor(block.id, headingTagMap)
          : tr.strikethroughs;
      ankiNote.number = counter++;
      if (hierarchyEnabled && isBasicType) {
        applyHierarchyFields(ankiNote, block.id, headingContextMap);
      }

      ankiNote.name = perserveNewlinesIfApplicable(
        ankiNote.name,
        this.settings
      );
      if (ankiNote.back) {
        ankiNote.back = perserveNewlinesIfApplicable(
          ankiNote.back,
          this.settings
        );
      }

      cards.push(ankiNote);

      const refreshIconRequested = ankiNote.hasRefreshIcon();
      if (
        !this.settings.isCherry &&
        (this.settings.basicReversed || refreshIconRequested) &&
        isBasicType
      ) {
        cards.push(ankiNote.reversed(ankiNote));
      }
      if (refreshIconRequested) {
        ankiNote.stripRefreshIcon();
      }
      tr.clear();
    }

    if (this.settings.isCherry) {
      cards = cards.filter((c) => c.hasCherry());
    }
    if (this.settings.isAvocado) {
      cards = cards.filter((c) => !c.hasAvocado());
    }

    if (this.settings.useTags && tags.length > 0) {
      cards.forEach((c) => {
        c.tags ||= [];
        c.tags = [...new Set(tags.concat(sanitizeTags(c.tags)))];
      });
    }

    this.cardCount += cards.length;
    this.emptyBackCount += countEmptyBacks(
      cards,
      (c) => c.back,
      (c) => c.name,
      (c) =>
        !c.isValidMCQNote() && !c.isValidClozeNote() && !c.isValidInputNote()
    );

    return cards; // .filter((c) => !c.isValid());
  }

  async findFlashcards(locator: Finder): Promise<Deck[]> {
    const { parentType, topLevelId, rules, decks } = locator;
    if (parentType === 'page') {
      try {
        return await this.findFlashcardsFromPage(locator);
      } catch (error) {
        if (isNotionDatabaseNotPageError(error)) {
          return this.findFlashcardsFromDatabaseRows(locator, true);
        }
        throw error;
      }
    }
    if (
      parentType === 'notion-database' ||
      parentType === 'database' ||
      parentType === 'data_source'
    ) {
      return this.findFlashcardsFromDatabaseRows(locator);
    }
    console.error(`[notion] unsupported parentType: ${parentType}`);
    return [];
  }

  async findFlashcardsFromDatabaseRows(
    locator: Finder,
    viaPageLinkSelfHeal = false
  ): Promise<Deck[]> {
    this.resolvedDatabasePath = { viaPageLinkSelfHeal };
    const { topLevelId, decks } = locator;
    const dbResult = await this.api.queryDatabase(topLevelId, true);
    const database = await this.api.getDatabase(topLevelId);
    const dbName = await this.api.getDatabaseTitle(database, this.settings);

    const firstRow = dbResult.results[0] as
      | { properties?: Record<string, unknown> }
      | undefined;
    const columnNames =
      firstRow?.properties != null ? Object.keys(firstRow.properties) : [];

    let frontField = locator.frontField;
    let backField = locator.backField;

    if (frontField == null || backField == null) {
      const inferred = inferColumnMapping(columnNames);
      if (inferred.ambiguous) {
        frontField = columnNames[0];
        backField = columnNames[1];
        if (frontField != null && backField != null) {
          this.guessedColumnMapping = { frontField, backField };
        }
      } else {
        frontField = inferred.frontField ?? undefined;
        backField = inferred.backField ?? undefined;
      }
    }

    if (
      frontField == null ||
      backField == null ||
      !columnNames.includes(frontField) ||
      !columnNames.includes(backField)
    ) {
      throw new Error(
        `Front or back column not found in database. Got: ${columnNames.join(', ')}`
      );
    }

    let notes = notesFromRows(
      dbResult.results,
      frontField,
      backField as string
    );

    // The mapping can name two columns that every row leaves blank — a status
    // or owner field, say — which reads as "this database has no cards." The
    // rows are already in memory, so try the other pairs before giving up.
    if (notes.length === 0) {
      for (const candidate of orderedColumnPairs(
        columnNames,
        frontField,
        backField
      )) {
        const rescued = notesFromRows(
          dbResult.results,
          candidate.frontField,
          candidate.backField
        );
        if (rescued.length > 0) {
          notes = rescued;
          this.guessedColumnMapping = candidate;
          break;
        }
      }
    }

    const deck = new Deck(
      dbName,
      Deck.CleanCards(notes),
      undefined,
      this.buildDeckStyle(),
      get16DigitRandomId(),
      this.settings
    );
    decks.push(deck);
    return decks;
  }

  async findFlashcardsFromPage(
    locator: Finder,
    globalSeenIds?: Set<string>
  ): Promise<Deck[]> {
    const { topLevelId, rules, parentName } = locator;
    if (!globalSeenIds) globalSeenIds = new Set<string>();

    const parentSettings = this.settings;
    this.settings = await this.resolvePageSettings(topLevelId);
    try {
      return await this.collectDecksFromPage(
        topLevelId,
        rules,
        parentName,
        locator.decks,
        globalSeenIds
      );
    } finally {
      this.settings = parentSettings;
    }
  }

  // A toggleable heading is carded as front/back when nothing card-shaped
  // lives inside it. But when real toggle blocks sit underneath — the
  // "collapsible chapter heading" page shape from #3947 — carding the wrapper
  // swallows the whole subtree into one giant card. Those headings are
  // sections, not cards: replace them with their (recursively expanded)
  // children and keep the heading itself as a plain heading so the tag and
  // hierarchy maps still see the section.
  private async expandToggleHeadingSections(
    blocks: GetBlockResponse[],
    flashCardTypes: string[],
    depth = 0,
    seen: Set<string> = new Set<string>()
  ): Promise<GetBlockResponse[]> {
    const maxDepth = 5;
    if (!flashCardTypes.includes('toggle') || depth >= maxDepth) {
      return blocks;
    }

    const expanded: GetBlockResponse[] = [];
    for (const block of blocks) {
      if (
        !isFullBlock(block) ||
        !isToggleHeading(block) ||
        !block.has_children ||
        seen.has(block.id)
      ) {
        expanded.push(block);
        continue;
      }
      seen.add(block.id);
      let children: GetBlockResponse[];
      try {
        const response = await this.api.getBlocks({
          createdAt: block.created_time,
          lastEditedAt: block.last_edited_time,
          id: block.id,
          all: this.useAll,
          type: block.type,
        });
        children = await expandSyncedBlocks(
          response.results,
          this.api,
          this.useAll
        );
      } catch (error) {
        console.info(
          '[toggle-heading] section fetch failed, keeping heading as card'
        );
        console.error(error);
        expanded.push(block);
        continue;
      }
      const expandedChildren = await this.expandToggleHeadingSections(
        children,
        flashCardTypes,
        depth + 1,
        seen
      );
      const containsToggles = expandedChildren.some(
        (child) => isFullBlock(child) && child.type === 'toggle'
      );
      if (containsToggles) {
        expanded.push(asPlainHeading(block), ...expandedChildren);
      } else {
        expanded.push(block);
      }
    }
    return expanded;
  }

  private async collectDecksFromPage(
    topLevelId: string,
    rules: ParserRules,
    parentName: string,
    initialDecks: Deck[],
    globalSeenIds: Set<string>
  ): Promise<Deck[]> {
    let decks = initialDecks;

    const page = await this.api.getPage(topLevelId);
    const createdAt = (page as PageObjectResponse).created_time;
    const lastEditedAt = (page as PageObjectResponse).last_edited_time;
    const tags = await this.api.getTopLevelTags(
      topLevelId,
      rules,
      createdAt,
      lastEditedAt
    );
    const response = await this.api.getBlocks({
      createdAt,
      lastEditedAt,
      id: topLevelId,
      all: this.useAll,
      type: 'page',
    });
    this.recordTruncation(response, rules);
    const topLevelBlocks = await expandSyncedBlocks(
      response.results,
      this.api,
      this.useAll
    );
    const flashCardTypes = rules.flaschardTypeNames();
    const blocks = await this.expandToggleHeadingSections(
      topLevelBlocks,
      flashCardTypes
    );

    const title = await this.api.getPageTitle(page, this.settings);
    if (!this.firstPageTitle) {
      this.firstPageTitle = title;
    }

    const currentDeckName = toText(getDeckName(parentName, title));
    const nonPageDeckTypes = activeNonPageDeckTypes(rules);

    // Depth-first traversal: process current page, then children
    if (rules.permitsDeckAsPage() && page) {
      const classifyRules = { flashcardTypes: flashCardTypes };
      const isCardBlock = (b: GetBlockResponse): boolean => {
        if (!isFullBlock(b)) {
          return false;
        }
        if (nonPageDeckTypes.has(b.type)) {
          return false;
        }
        return (
          classifyBlock(
            { type: b.type, hasToggleableHeading: isToggleHeading(b) },
            classifyRules
          ) === 'card'
        );
      };
      const cBlocks = blocks.filter(isCardBlock);
      const headingTagMap =
        rules.TAGS === 'heading'
          ? buildHeadingTagMap(blocks, isCardBlock)
          : new Map<string, string>();
      const headingContextMap =
        this.settings.template === 'hierarchy'
          ? buildHeadingContextMap(blocks, isCardBlock)
          : new Map<string, HeadingContext>();
      this.settings.parentBlockId = page.id;

      let notionBaseLink =
        this.settings.addNotionLink && this.settings.parentBlockId
          ? isFullPage(page)
            ? page?.url
            : undefined
          : undefined;
      let cards = await this.getFlashcards(
        rules,
        cBlocks,
        tags,
        notionBaseLink,
        headingTagMap,
        headingContextMap
      );
      cards = cards.filter((card) => {
        if (
          typeof card.notionId === 'string' &&
          globalSeenIds.has(card.notionId)
        ) {
          return false;
        }
        if (typeof card.notionId === 'string') globalSeenIds.add(card.notionId);
        return true;
      });
      cards = this.rescueEmptyCards(cards, blocks);
      const deck = new Deck(
        currentDeckName,
        Deck.CleanCards(cards),
        undefined,
        this.buildDeckStyle(),
        get16DigitRandomId(),
        this.settings
      );
      decks.push(deck);
    }

    // Traverse child_page blocks in strict order
    for (const block of blocks) {
      if (isFullBlock(block) && block.type === 'child_page') {
        const subPage = await this.api.getPage(block.id);
        if (subPage) {
          decks = await this.findFlashcardsFromPage(
            {
              parentType: block.type,
              topLevelId: block.id,
              rules,
              decks,
              parentName: currentDeckName,
            },
            globalSeenIds
          );
        }
      }
    }

    if (this.useAll) {
      const subDecks = blocks.filter((b) => {
        if ('type' in b) {
          return rules.SUB_DECKS.includes(b.type);
        }
      });
      for (const sd of subDecks) {
        if (isFullBlock(sd)) {
          if (
            sd.type === 'child_database' &&
            rules.SUB_DECKS.includes('child_database')
          ) {
            const dbDecks = await this.handleChildDatabase(sd, rules);
            decks.push(...dbDecks);
            continue;
          }

          decks.push(
            await this.buildDeckFromBlockChildren(
              sd,
              rules,
              tags,
              flashCardTypes,
              globalSeenIds
            )
          );
          continue;
        }
        const subPage = await this.api.getPage(sd.id);
        if (subPage && isFullBlock(sd)) {
          decks = await this.findFlashcardsFromPage(
            {
              parentType: sd.type,
              topLevelId: sd.id,
              rules,
              decks,
              parentName: currentDeckName,
            },
            globalSeenIds
          );
        }
      }

      const nonPageDeckBlocks = blocks.filter(
        (b): b is BlockObjectResponse =>
          isFullBlock(b) && nonPageDeckTypes.has(b.type)
      );
      for (const deckBlock of nonPageDeckBlocks) {
        decks.push(
          await this.buildDeckFromBlockChildren(
            deckBlock,
            rules,
            tags,
            flashCardTypes,
            globalSeenIds
          )
        );
      }
    }
    return decks;
  }

  private accountForRescuedCards(cards: Note[]): void {
    this.cardCount += cards.length;
    this.emptyBackCount += countEmptyBacks(
      cards,
      (c) => c.back,
      (c) => c.name
    );
  }

  // Which candidates the rescue may offer. clozeFromToggleContent assumes a
  // toggle front, so no structural or text-pattern candidate is coherent with
  // it — skip induction entirely and fail honest. In the hierarchy template
  // headings are consumed as breadcrumb context, so the heading candidate is
  // invalid while it is on.
  private rescueCandidateRules(): InducedRule[] {
    // isCherry restricts the deck to cherry-marked blocks; getFlashcards has
    // already applied that filter, so inducing a whole-page deck here would
    // override the user's explicit selection. Skip induction and fail honest,
    // same as clozeFromToggleContent (which assumes a toggle front).
    if (this.settings.clozeFromToggleContent || this.settings.isCherry) {
      return [];
    }
    const rules = [...NOTION_CANDIDATE_RULES];
    if (this.settings.template === 'hierarchy') {
      return rules.filter((rule) => rule !== 'heading');
    }
    return rules;
  }

  // Re-derives the card boundary from the document's own structure over the
  // blocks already in memory — zero extra Notion requests. Each candidate is
  // scored; the best that clears the quality floor ships, ties broken most
  // conservative first. Nothing above the floor means we fail honest.
  private induceRescueDeck(blocks: GetBlockResponse[]): Note[] | null {
    const rules = this.rescueCandidateRules();
    if (rules.length === 0) {
      return null;
    }
    const { winner, best } = runInduction(
      rules,
      (rule) =>
        induceNotesFromBlocks(blocks, rule, this.settings, new TagRegistry()),
      blocksPlainTextLength(blocks)
    );
    if (winner == null) {
      if (best != null) {
        this.recordInducedRule({
          rule: best.rule,
          outcome: 'rescue_rejected',
          score: best.score,
        });
      }
      return null;
    }
    this.recordInducedRule({
      rule: winner.rule,
      outcome: 'rescue_shipped',
      score: winner.score,
    });
    return winner.cards;
  }

  private recordInducedRule(next: InducedRescue): void {
    this.inducedRule = mergeInducedRescue(this.inducedRule, next);
  }

  private discountCards(cards: Note[]): void {
    this.cardCount -= cards.length;
    this.emptyBackCount -= countEmptyBacks(
      cards,
      (c) => c.back,
      (c) => c.name,
      (c) =>
        !c.isValidMCQNote() && !c.isValidClozeNote() && !c.isValidInputNote()
    );
  }

  // Cards that Deck.CleanCards will strip — a toggle with an empty body, say —
  // still make the walk look productive, so the deck ships empty with the
  // rescue never attempted. Measure what survives cleaning instead, and induce
  // candidate decks over the blocks already in memory so no Notion request is
  // added.
  private rescueEmptyCards(cards: Note[], blocks: GetBlockResponse[]): Note[] {
    if (Deck.hasUsableCards(cards)) {
      return this.rescueDegenerateYield(cards, blocks);
    }
    const rescued = this.induceRescueDeck(blocks);
    if (rescued == null) {
      return cards;
    }
    this.discountCards(cards);
    this.accountForRescuedCards(rescued);
    return rescued;
  }

  // The silent twin of the empty deck: a walk that produces one or two cards
  // whose backs hold the whole page ships as "success" while the substance never
  // becomes reviewable cards. Runs the same block-level candidate loop as the
  // empty rescue, but the winner must beat the score of the giant card it
  // replaces, not just clear the floor. Losing records rescue_rejected and keeps
  // the original cards; winning replaces them and records rescue_shipped, so the
  // Downloads notice fires on both delivery transports.
  //
  // The mean-chars trigger sits at 1000 from a prod Notion-path sweep: the
  // degenerate cluster (pages that shipped <=2 cards from a large body) had a
  // mean of ~1509 chars/card, while legitimate small decks sat at <=622 and a
  // healthy deck runs ~230. Image-only backs strip to ~0 visible chars and so
  // self-exclude. MCQ and input cards are user-authored quiz structure and are
  // never re-induced.
  private rescueDegenerateYield(
    cards: Note[],
    blocks: GetBlockResponse[]
  ): Note[] {
    const DEGENERATE_MIN_MEAN_CARD_CHARS = 1000;
    const cleaned = Deck.CleanCards([...cards]);
    if (cleaned.length < 1 || cleaned.length > 2) {
      return cards;
    }
    if (
      cleaned.every((card) => card.isValidMCQNote() || card.isValidInputNote())
    ) {
      return cards;
    }
    const docChars = blocksPlainTextLength(blocks);
    const existingScore = scoreCandidateDeck(cleaned, docChars);
    if (
      existingScore.cardChars / cleaned.length <
      DEGENERATE_MIN_MEAN_CARD_CHARS
    ) {
      return cards;
    }
    const { winner, best } = runInduction(
      this.rescueCandidateRules(),
      (rule) =>
        induceNotesFromBlocks(blocks, rule, this.settings, new TagRegistry()),
      docChars
    );
    if (winner == null || winner.score.score <= existingScore.score) {
      const judged = winner ?? best;
      if (judged != null) {
        this.recordInducedRule({
          rule: judged.rule,
          outcome: 'rescue_rejected',
          score: judged.score,
        });
      }
      return cards;
    }
    this.recordInducedRule({
      rule: winner.rule,
      outcome: 'rescue_shipped',
      score: winner.score,
    });
    this.discountCards(cards);
    this.accountForRescuedCards(winner.cards);
    return winner.cards;
  }

  private async buildDeckFromBlockChildren(
    block: BlockObjectResponse,
    rules: ParserRules,
    tags: string[],
    flashCardTypes: string[],
    globalSeenIds: Set<string>
  ): Promise<Deck> {
    const res = await this.api.getBlocks({
      createdAt: block.created_time,
      lastEditedAt: block.last_edited_time,
      id: block.id,
      all: this.useAll,
      type: block.type,
    });
    const childBlocks = await expandSyncedBlocks(
      res.results,
      this.api,
      this.useAll
    );
    const toggleHeadingsEnabled = flashCardTypes.includes('toggle');
    const isChildCardBlock = (b: GetBlockResponse): boolean => {
      if (!isFullBlock(b)) return false;
      if (flashCardTypes.includes(b.type)) return true;
      return toggleHeadingsEnabled && isToggleHeading(b);
    };
    const cardBlocks = childBlocks.filter(isChildCardBlock);
    const childHeadingTagMap =
      rules.TAGS === 'heading'
        ? buildHeadingTagMap(childBlocks, isChildCardBlock)
        : new Map<string, string>();
    const childHeadingContextMap =
      this.settings.template === 'hierarchy'
        ? buildHeadingContextMap(childBlocks, isChildCardBlock)
        : new Map<string, HeadingContext>();

    this.settings.parentBlockId = block.id;
    let cards = await this.getFlashcards(
      rules,
      cardBlocks,
      tags,
      undefined,
      childHeadingTagMap,
      childHeadingContextMap
    );
    cards = cards.filter((card) => {
      if (
        typeof card.notionId === 'string' &&
        globalSeenIds.has(card.notionId)
      ) {
        return false;
      }
      if (typeof card.notionId === 'string') globalSeenIds.add(card.notionId);
      return true;
    });
    cards = this.rescueEmptyCards(cards, childBlocks);

    return new Deck(
      getDeckName(
        this.settings.deckName || this.firstPageTitle || '',
        getSubDeckName(block)
      ),
      cards,
      undefined,
      this.buildDeckStyle(),
      get16DigitRandomId(),
      this.settings
    );
  }

  private recordTruncation(
    response: ListBlockChildrenResponse,
    rules: ParserRules
  ): void {
    if (!isTruncatedBlockFetch(this.useAll, response)) {
      return;
    }
    this.truncation = {
      blocksConverted:
        (this.truncation?.blocksConverted ?? 0) + response.results.length,
      subDeckRulesSkipped:
        this.truncation?.subDeckRulesSkipped === true ||
        hasRuleBasedSubDecks(rules),
    };
  }

  private async handleChildDatabase(
    sd: BlockObjectResponse,
    rules: ParserRules
  ): Promise<Deck[]> {
    const dbResult = await this.api.queryDatabase(sd.id, true);
    const database = await this.api.getDatabase(sd.id);
    const dbName = await this.api.getDatabaseTitle(database, this.settings);
    let dbDecks: Deck[] = [];

    for (const entry of dbResult.results) {
      const entryDecks = await this.findFlashcardsFromPage({
        parentType: 'database',
        topLevelId: entry.id,
        rules,
        decks: [],
        parentName: dbName,
      });
      dbDecks.push(...entryDecks);
    }
    return dbDecks;
  }
}

export default BlockHandler;

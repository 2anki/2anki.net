export const NOTION_TRUNCATED_CODE = 'notion_truncated';
export const NOTION_ASSETS_DROPPED_CODE = 'notion_assets_dropped';
export const NOTION_COLUMNS_GUESSED_CODE = 'notion_columns_guessed';
export const NOTION_STRUCTURE_RESCUED_CODE = 'notion_structure_rescued';
export const NOTION_UNSUPPORTED_BLOCKS_CODE = 'notion_unsupported_blocks';
export const NOTION_DATABASE_RESOLVED_CODE = 'notion_database_resolved';
export const MONTHLY_LIMIT_PARTIAL_CODE = 'monthly_limit_partial';

export interface MonthlyLimitPartial {
  cardsDelivered: number;
  cardsHeldBack: number;
  limit: number;
  resetOn: string;
}

export function buildMonthlyLimitPartialPayload(
  partial: MonthlyLimitPartial
): string {
  return JSON.stringify({
    code: MONTHLY_LIMIT_PARTIAL_CODE,
    cards_delivered: partial.cardsDelivered,
    cards_held_back: partial.cardsHeldBack,
    limit: partial.limit,
    reset_on: partial.resetOn,
  });
}

export interface ConversionTruncation {
  blocksConverted: number;
  subDeckRulesSkipped: boolean;
}

export interface GuessedColumnMapping {
  frontField: string;
  backField: string;
}

export interface ResolvedDatabasePath {
  viaPageLinkSelfHeal: boolean;
}

export function isTruncatedBlockFetch(
  all: boolean,
  response: { has_more: boolean }
): boolean {
  return !all && response.has_more;
}

export function hasRuleBasedSubDecks(rules: { SUB_DECKS: string[] }): boolean {
  return rules.SUB_DECKS.some((type) => type !== 'child_page');
}

function pickSignalCode(
  truncation: ConversionTruncation | undefined,
  hasDroppedAssets: boolean,
  guessedColumns: GuessedColumnMapping | undefined,
  hasUnsupportedBlocks: boolean,
  structureRescuedRule: string | undefined
): string {
  // A rescued deck is the whole story of the conversion — the cards came from
  // an inferred structure, not toggles — so it takes priority over the softer
  // signals below.
  if (structureRescuedRule != null) {
    return NOTION_STRUCTURE_RESCUED_CODE;
  }
  if (truncation != null) {
    return NOTION_TRUNCATED_CODE;
  }
  if (hasDroppedAssets) {
    return NOTION_ASSETS_DROPPED_CODE;
  }
  if (guessedColumns != null) {
    return NOTION_COLUMNS_GUESSED_CODE;
  }
  if (hasUnsupportedBlocks) {
    return NOTION_UNSUPPORTED_BLOCKS_CODE;
  }
  return NOTION_DATABASE_RESOLVED_CODE;
}

export function buildNotionConversionSignalPayload(
  truncation: ConversionTruncation | undefined,
  droppedAssetCount: number,
  guessedColumns?: GuessedColumnMapping,
  resolvedDatabasePath?: ResolvedDatabasePath,
  unsupportedBlocks?: Record<string, number>,
  structureRescuedRule?: string
): string | undefined {
  const hasDroppedAssets = droppedAssetCount > 0;
  const hasUnsupportedBlocks = Object.keys(unsupportedBlocks ?? {}).length > 0;
  if (
    truncation == null &&
    !hasDroppedAssets &&
    guessedColumns == null &&
    resolvedDatabasePath == null &&
    !hasUnsupportedBlocks &&
    structureRescuedRule == null
  ) {
    return undefined;
  }

  const payload: {
    code: string;
    blocks_converted?: number;
    sub_deck_rules_skipped?: boolean;
    dropped_assets?: number;
    front_field?: string;
    back_field?: string;
    via_page_link_selfheal?: boolean;
    unsupported_blocks?: Record<string, number>;
    rule?: string;
  } = {
    code: pickSignalCode(
      truncation,
      hasDroppedAssets,
      guessedColumns,
      hasUnsupportedBlocks,
      structureRescuedRule
    ),
  };

  if (structureRescuedRule != null) {
    payload.rule = structureRescuedRule;
  }

  if (truncation != null) {
    payload.blocks_converted = truncation.blocksConverted;
    payload.sub_deck_rules_skipped = truncation.subDeckRulesSkipped;
  }

  if (hasDroppedAssets) {
    payload.dropped_assets = droppedAssetCount;
  }

  if (guessedColumns != null) {
    payload.front_field = guessedColumns.frontField;
    payload.back_field = guessedColumns.backField;
  }

  if (resolvedDatabasePath != null) {
    payload.via_page_link_selfheal = resolvedDatabasePath.viaPageLinkSelfHeal;
  }

  if (hasUnsupportedBlocks) {
    payload.unsupported_blocks = unsupportedBlocks;
  }

  return JSON.stringify(payload);
}

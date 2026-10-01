export const NOTION_TRUNCATED_CODE = 'notion_truncated';
export const NOTION_ASSETS_DROPPED_CODE = 'notion_assets_dropped';
export const NOTION_COLUMNS_GUESSED_CODE = 'notion_columns_guessed';
export const NOTION_STRUCTURE_RESCUED_CODE = 'notion_structure_rescued';
export const NOTION_BLOCKS_FORBIDDEN_CODE = 'notion_blocks_forbidden';
export const NOTION_UNSUPPORTED_BLOCKS_CODE = 'notion_unsupported_blocks';
export const NOTION_DATABASE_RESOLVED_CODE = 'notion_database_resolved';
export const MONTHLY_LIMIT_PARTIAL_CODE = 'monthly_limit_partial';

export const CONVERSION_SIGNAL_CODES = [
  NOTION_TRUNCATED_CODE,
  NOTION_ASSETS_DROPPED_CODE,
  NOTION_COLUMNS_GUESSED_CODE,
  NOTION_STRUCTURE_RESCUED_CODE,
  NOTION_BLOCKS_FORBIDDEN_CODE,
  NOTION_UNSUPPORTED_BLOCKS_CODE,
  NOTION_DATABASE_RESOLVED_CODE,
  MONTHLY_LIMIT_PARTIAL_CODE,
] as const;

export type ConversionSignalCode = (typeof CONVERSION_SIGNAL_CODES)[number];

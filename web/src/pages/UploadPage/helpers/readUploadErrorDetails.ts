import type { TooLongSetting } from '@server/types/UploadErrorBody';

const SETTINGS: ReadonlySet<string> = new Set([
  'user_instructions',
  'deck_name',
]);

export function readTooLongSetting(value: unknown): TooLongSetting | undefined {
  return typeof value === 'string' && SETTINGS.has(value)
    ? (value as TooLongSetting)
    : undefined;
}

import { S3FileName, SuffixFrom } from '../misc/file';

export const DECK_NAME_SUFFIX = 'apkg';

// Formats Anki's bundled player handles. Notion keeps the original extension
// of whatever the user uploaded or recorded (iOS voice memos are .m4a,
// browser recordings .webm), so mp3-only meant most real audio never embedded.
export const AUDIO_FILE_SUFFIXES = [
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'oga',
  'opus',
  'flac',
  'aac',
  'webm',
];

export const isValidDeckName = (filename: string) =>
  filename.endsWith(`.${DECK_NAME_SUFFIX}`);

export const addDeckNameSuffix = (filename: string) =>
  `${filename}.${DECK_NAME_SUFFIX}`;

export const isValidAudioFile = (filename: string) => {
  const lower = filename.toLowerCase();
  return AUDIO_FILE_SUFFIXES.some((suffix) => lower.endsWith(`.${suffix}`));
};

export const DEFAULT_AUDIO_EXTENSION = '.mp3';

// Anki registers a sound by its filename extension, so a Notion upload stored
// without one never plays. Keep the extension already on the URL when Anki's
// player handles it; otherwise fall back to mp3 so the file stays playable.
export const audioFileExtensionFromUrl = (url: string): string => {
  const suffix = SuffixFrom(S3FileName(url));
  if (suffix) {
    const bare = suffix.slice(1).toLowerCase();
    if (AUDIO_FILE_SUFFIXES.includes(bare)) {
      return suffix;
    }
    if (bare === 'mp4') {
      return '.m4a';
    }
  }
  return DEFAULT_AUDIO_EXTENSION;
};

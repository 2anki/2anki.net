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

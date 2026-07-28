// Which extraction engine actually produced the deck. The entry point a user
// came through (source) and the engine that ran are independent: the same web
// upload runs through the parser or through Claude depending on the account and
// the settings, and those two produce very differently shaped decks. Recording
// only one of the two axes makes the scores incomparable.
export type ConversionEngine = 'parser' | 'claude';

export const CONVERSION_ENGINES: readonly ConversionEngine[] = [
  'parser',
  'claude',
];

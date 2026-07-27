// Deck quality is invisible today: a conversion that yields three giant
// unusable cards is recorded as a success, and 15 189 cards have shipped with a
// blank back without anything flagging it. This turns a parsed deck into a
// number plus the sub-signals behind it, so "is the conversion getting better"
// becomes answerable.
//
// Pure and deterministic — no workspace, no Python, no model call. Score the
// raw notes BEFORE processPayload, which mutates cards in place.
//
// The weights and bands below are named constants rather than measured
// percentiles. Nothing in production stores card text, so a real corpus
// calibration has to come from re-converting retained upload files; until that
// runs, treat the composite as provisional and the sub-signals as the truth.

export interface ScorableCard {
  name: string;
  back: string;
  cloze?: boolean;
}

export interface DeckScore {
  score: number;
  cardCount: number;
  docChars: number;
  medianFrontLen: number;
  medianBackLen: number;
  blankBackRate: number;
  duplicateFrontRate: number;
  coverage: number;
  balance: number;
  density: number;
}

// A back below the floor is usually a stub; above the ceiling it is a wall of
// text the learner will not review. Anything inside the band scores full marks.
export const GRANULARITY_MIN_BACK_CHARS = 40;
export const GRANULARITY_MAX_BACK_CHARS = 600;

// One card per this many source characters is treated as full coverage of a
// document's card potential. Below it the extractor left material behind.
export const EXPECTED_CHARS_PER_CARD = 350;

export const WEIGHTS = {
  granularity: 0.2,
  coverage: 0.2,
  balance: 0.15,
  blankBack: 0.2,
  duplicateFront: 0.15,
  density: 0.1,
} as const;

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Full marks inside the band, then a linear fall-off that reaches zero one band
// width outside it, so a 30-character back is penalised gently and a 5 000
// character one is not.
function granularityScore(medianBackLen: number): number {
  if (
    medianBackLen >= GRANULARITY_MIN_BACK_CHARS &&
    medianBackLen <= GRANULARITY_MAX_BACK_CHARS
  ) {
    return 1;
  }
  if (medianBackLen < GRANULARITY_MIN_BACK_CHARS) {
    return clamp01(medianBackLen / GRANULARITY_MIN_BACK_CHARS);
  }
  const overshoot = medianBackLen - GRANULARITY_MAX_BACK_CHARS;
  return clamp01(1 - overshoot / GRANULARITY_MAX_BACK_CHARS);
}

export function scoreCandidateDeck(
  cards: readonly ScorableCard[],
  docChars: number
): DeckScore {
  const cardCount = cards.length;
  if (cardCount === 0) {
    return {
      score: 0,
      cardCount: 0,
      docChars,
      medianFrontLen: 0,
      medianBackLen: 0,
      blankBackRate: 0,
      duplicateFrontRate: 0,
      coverage: 0,
      balance: 0,
      density: 0,
    };
  }

  const fronts = cards.map((card) => plainText(card.name ?? ''));
  const backs = cards.map((card) => plainText(card.back ?? ''));

  const medianFrontLen = median(fronts.map((front) => front.length));
  const medianBackLen = median(backs.map((back) => back.length));

  // A cloze card carries its answer on the front, so an empty back is correct
  // for it and must not count against the deck.
  const blankBackCandidates = cards.filter((card) => card.cloze !== true);
  const blankBacks = blankBackCandidates.filter(
    (card) => plainText(card.back ?? '').length === 0
  ).length;
  const blankBackRate =
    blankBackCandidates.length === 0
      ? 0
      : blankBacks / blankBackCandidates.length;

  const distinctFronts = new Set(fronts.map((front) => front.toLowerCase()));
  const duplicateFrontRate = 1 - distinctFronts.size / cardCount;

  const cardChars = fronts.reduce(
    (sum, front, i) => sum + front.length + backs[i].length,
    0
  );
  const coverage = docChars <= 0 ? 0 : clamp01(cardChars / docChars);

  const balanced = cards.filter(
    (card, i) => card.cloze === true || fronts[i].length < backs[i].length
  ).length;
  const balance = balanced / cardCount;

  const expectedCards =
    docChars <= 0 ? 0 : Math.max(1, docChars / EXPECTED_CHARS_PER_CARD);
  const density = expectedCards === 0 ? 0 : clamp01(cardCount / expectedCards);

  const score = clamp01(
    WEIGHTS.granularity * granularityScore(medianBackLen) +
      WEIGHTS.coverage * coverage +
      WEIGHTS.balance * balance +
      WEIGHTS.blankBack * (1 - blankBackRate) +
      WEIGHTS.duplicateFront * (1 - duplicateFrontRate) +
      WEIGHTS.density * density
  );

  return {
    score,
    cardCount,
    docChars,
    medianFrontLen,
    medianBackLen,
    blankBackRate,
    duplicateFrontRate,
    coverage,
    balance,
    density,
  };
}

export default scoreCandidateDeck;

// When the connection to an upload drops, the server still finishes the deck
// and keeps it (My Decks for a signed-in account, a recovery copy for a
// visitor). How long to keep looking depends on how far the upload got: a
// request that died within seconds most likely never reached the server, so
// the wait is short; one that ran for a while was probably converting.
const EARLY_FAILURE_MS = 5_000;
const EARLY_WAIT_MS = 20_000;
const LONG_WAIT_MS = 6 * 60_000;
const FAST_CHECK_MS = 4_000;
const SLOW_CHECK_MS = 10_000;
const FAST_CHECK_WINDOW_MS = 60_000;

// The pauses between checks; the first check is made straight away.
export function dropWaitDelays(elapsedMs: number): number[] {
  const windowMs = elapsedMs < EARLY_FAILURE_MS ? EARLY_WAIT_MS : LONG_WAIT_MS;
  const delays: number[] = [];
  let waited = 0;
  while (waited < windowMs) {
    const step = waited < FAST_CHECK_WINDOW_MS ? FAST_CHECK_MS : SLOW_CHECK_MS;
    delays.push(step);
    waited += step;
  }
  return delays;
}

import { useEffect, useRef } from 'react';

import type { Backend } from '../backend/Backend';
import { reportClientError } from '../reportClientError';

const CHECKOUT_CLAIM_RETRIES = 5;
const CHECKOUT_CLAIM_RETRY_MS = 3000;
const QUIET_CLAIM_STATUSES = new Set([200, 404, 410]);

type HeldDeckClaimer = Pick<Backend, 'getHeldDeck' | 'claimHeldDeck'>;

// A checkout that returns somewhere other than the upload page (Auto Sync
// lands on its setup page) still owes the buyer the deck saved for a plan.
// Once the plan is active, the saved deck is built into My decks in the
// background; the page the buyer is on stays as it is. The hold can take a
// few seconds after the webhook to become visible, so the check retries the
// way the upload page does.
export function useClaimHeldDeckAfterCheckout(
  api: HeldDeckClaimer,
  ready: boolean
): void {
  const startedRef = useRef(false);
  const apiRef = useRef(api);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    const claimer = apiRef.current;
    (async () => {
      try {
        let hold = await claimer.getHeldDeck();
        for (
          let attempt = 0;
          hold == null && attempt < CHECKOUT_CLAIM_RETRIES;
          attempt++
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, CHECKOUT_CLAIM_RETRY_MS)
          );
          if (cancelled) return;
          hold = await claimer.getHeldDeck();
        }
        if (cancelled || hold == null) return;
        const result = await claimer.claimHeldDeck();
        if (!QUIET_CLAIM_STATUSES.has(result.status)) {
          reportClientError(
            new Error(
              `Held deck claim after checkout failed (HTTP ${result.status})`
            ),
            { surface: 'held_deck_claim_after_checkout' }
          );
        }
      } catch (error) {
        reportClientError(error, { surface: 'held_deck_claim_after_checkout' });
      }
    })();
    return () => {
      cancelled = true;
      startedRef.current = false;
    };
  }, [ready]);
}

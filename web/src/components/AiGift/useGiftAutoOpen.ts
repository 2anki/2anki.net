import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CONSENT_CHANGE_EVENT, needsBanner } from '../../lib/consent/consent';
import {
  readUploadZoneActivity,
  subscribeUploadZoneActivity,
} from '../../lib/upload/uploadZoneActivity';
import {
  hasGiftOpenedBefore,
  isGiftDismissed,
  pageLoadedFromCheckout,
} from './giftUiState';

export const GIFT_AUTO_OPEN_DELAY_MS = 1000;

function useCookieBannerShowing(): boolean {
  const [showing, setShowing] = useState(() => needsBanner());
  useEffect(() => {
    const refresh = () => setShowing(needsBanner());
    globalThis.addEventListener(CONSENT_CHANGE_EVENT, refresh);
    return () => globalThis.removeEventListener(CONSENT_CHANGE_EVENT, refresh);
  }, []);
  return showing;
}

const visitorHasSeenGift = (): boolean =>
  hasGiftOpenedBefore() || isGiftDismissed();

export function useGiftAutoOpen(
  giftWaiting: boolean,
  onAutoOpen: () => void
): void {
  const uploadZone = useSyncExternalStore(
    subscribeUploadZoneActivity,
    readUploadZoneActivity
  );
  const bannerShowing = useCookieBannerShowing();
  const onAutoOpenRef = useRef(onAutoOpen);
  useEffect(() => {
    onAutoOpenRef.current = onAutoOpen;
  });

  const eligible =
    giftWaiting &&
    uploadZone === 'idle' &&
    !bannerShowing &&
    !pageLoadedFromCheckout() &&
    !visitorHasSeenGift();

  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => {
      if (visitorHasSeenGift()) return;
      onAutoOpenRef.current();
    }, GIFT_AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible]);
}

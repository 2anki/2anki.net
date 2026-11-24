import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CONSENT_CHANGE_EVENT, needsBanner } from '../../lib/consent/consent';
import { useUploadZoneActivity } from '../../lib/upload/uploadZoneActivity';
import {
  hasGiftOpenedBefore,
  isGiftDismissed,
  pageLoadedFromCheckout,
} from './giftUiState';

export const GIFT_AUTO_OPEN_DELAY_MS = 1000;
const WIDE_SCREEN_QUERY = '(min-width: 640px)';

function useCookieBannerShowing(): boolean {
  const [showing, setShowing] = useState(() => needsBanner());
  useEffect(() => {
    const refresh = () => setShowing(needsBanner());
    globalThis.addEventListener(CONSENT_CHANGE_EVENT, refresh);
    return () => globalThis.removeEventListener(CONSENT_CHANGE_EVENT, refresh);
  }, []);
  return showing;
}

function subscribeToScreenWidth(listener: () => void): () => void {
  const query = globalThis.matchMedia?.(WIDE_SCREEN_QUERY);
  query?.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
}

const isWideScreen = (): boolean =>
  globalThis.matchMedia?.(WIDE_SCREEN_QUERY).matches === true;

const visitorHasSeenGift = (): boolean =>
  hasGiftOpenedBefore() || isGiftDismissed();

export function useGiftAutoOpen(
  giftWaiting: boolean,
  onAutoOpen: () => void
): void {
  const uploadZone = useUploadZoneActivity();
  const wideScreen = useSyncExternalStore(subscribeToScreenWidth, isWideScreen);
  const bannerShowing = useCookieBannerShowing();
  const onAutoOpenRef = useRef(onAutoOpen);
  useEffect(() => {
    onAutoOpenRef.current = onAutoOpen;
  });

  const eligible =
    giftWaiting &&
    wideScreen &&
    uploadZone === 'idle' &&
    !bannerShowing &&
    !pageLoadedFromCheckout() &&
    !visitorHasSeenGift();

  useEffect(() => {
    if (!eligible) return;
    const openUnlessSeen = () => {
      if (visitorHasSeenGift()) return;
      onAutoOpenRef.current();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      openUnlessSeen();
    };
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        openUnlessSeen();
        return;
      }
      document.addEventListener('visibilitychange', onVisible);
    }, GIFT_AUTO_OPEN_DELAY_MS);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [eligible]);
}

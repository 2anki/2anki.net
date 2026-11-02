import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { get2ankiApi } from '../../lib/backend/get2ankiApi';

const SESSION_KEY = 'held_deck_redirect_checked';
const AUTO_SYNC_SETUP = '/ankify/setup';

function trimmedPath(pathname: string): string {
  return pathname.replace(/\/$/, '');
}

interface Props {
  readonly isLoggedIn: boolean;
}

// Most signup paths land on /upload, where the upload form claims the held
// deck on mount. Notion connect (and a returning user who already has Notion)
// lands on /notion instead, so this shell-level check runs once per signed-in
// session and sends the visitor to /upload when a hold is waiting. An Auto
// Sync checkout return claims in place on the setup page, so that one visit
// is left alone; the setup page drops checkout=success from the URL, so the
// landing URL is read once on mount.
export function HeldDeckClaimRedirect({ isLoggedIn }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const checkedRef = useRef(false);
  const [landedFromAutoSyncCheckout] = useState(
    () =>
      trimmedPath(location.pathname) === AUTO_SYNC_SETUP &&
      new URLSearchParams(location.search).get('checkout') === 'success'
  );

  useEffect(() => {
    if (!isLoggedIn || checkedRef.current) return;
    const path = trimmedPath(location.pathname);
    if (path === '/upload') return;
    if (path === AUTO_SYNC_SETUP && landedFromAutoSyncCheckout) return;
    if (globalThis.sessionStorage?.getItem(SESSION_KEY) === '1') return;
    checkedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const hold = await get2ankiApi().getHeldDeck();
        if (cancelled) return;
        globalThis.sessionStorage?.setItem(SESSION_KEY, '1');
        if (hold != null) {
          navigate('/upload');
        }
      } catch {
        // A failed check is never worth interrupting the session.
      }
    })();
    return () => {
      cancelled = true;
      checkedRef.current = false;
    };
  }, [isLoggedIn, location.pathname, navigate, landedFromAutoSyncCheckout]);

  return null;
}

export default HeldDeckClaimRedirect;

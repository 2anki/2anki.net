import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { get2ankiApi } from '../../lib/backend/get2ankiApi';

const SESSION_KEY = 'held_deck_redirect_checked';

interface Props {
  readonly isLoggedIn: boolean;
}

// Most signup paths land on /upload, where the upload form claims the held
// deck on mount. Notion connect (and a returning user who already has Notion)
// lands on /notion instead, so this shell-level check runs once per signed-in
// session and sends the visitor to /upload when a hold is waiting.
export function HeldDeckClaimRedirect({ isLoggedIn }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn || checkedRef.current) return;
    if (location.pathname === '/upload') return;
    if (globalThis.sessionStorage?.getItem(SESSION_KEY) === '1') return;
    checkedRef.current = true;
    globalThis.sessionStorage?.setItem(SESSION_KEY, '1');
    let cancelled = false;
    (async () => {
      try {
        const hold = await get2ankiApi().getHeldDeck();
        if (!cancelled && hold != null) {
          navigate('/upload');
        }
      } catch {
        // A failed check is never worth interrupting the session.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, location.pathname, navigate]);

  return null;
}

export default HeldDeckClaimRedirect;

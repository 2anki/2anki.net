import { useEffect, useId, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { track } from '../../../../lib/analytics/track';
import {
  RecoveryStorageBusyError,
  RecoveryUnavailableError,
} from '../../../../lib/backend/Backend';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import {
  getLastDeckStore,
  lastDeckExpiresAt,
  type LastDeck,
} from '../../../../lib/upload/lastDeck';
import sharedStyles from '../../../../styles/shared.module.css';
import formStyles from './UploadForm.module.css';

type DownloadNotice = 'gone' | 'busy' | 'unavailable' | 'failed';

const NOTICE_KEYS: Record<DownloadNotice, string> = {
  gone: 'gone',
  busy: 'storageBusy',
  unavailable: 'unavailable',
  failed: 'failed',
};

function displayName(deckName: string): string {
  return deckName.replace(/\.apkg$/i, '');
}

function saveDeck(deck: Blob, filename: string): void {
  const url = globalThis.URL.createObjectURL(deck);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.URL.revokeObjectURL(url);
}

function noticeFor(error: unknown): DownloadNotice {
  if (error instanceof RecoveryStorageBusyError) return 'busy';
  if (error instanceof RecoveryUnavailableError) return 'unavailable';
  return 'failed';
}

export function LastDeckOffer() {
  const { t, i18n } = useTranslation('lastDeck');
  const lineId = useId();
  const [lastDeck, setLastDeck] = useState<LastDeck | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<DownloadNotice | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getLastDeckStore()
      .load()
      .then((deck) => {
        if (!cancelled) setLastDeck(deck);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (notice === 'gone') {
      noticeRef.current?.focus();
    } else if (notice != null && !downloading) {
      buttonRef.current?.focus();
    }
  }, [notice, downloading]);

  if (lastDeck == null && notice == null) return null;

  const handleDownload = async (deck: LastDeck) => {
    setDownloading(true);
    setNotice(null);
    try {
      const blob = await get2ankiApi().getAnonymousRecoveredDeck(
        deck.recoveryToken
      );
      if (blob == null) {
        await getLastDeckStore().clear();
        setLastDeck(null);
        setNotice('gone');
        track('anon_deck_refetched', { outcome: 'expired' });
        return;
      }
      saveDeck(blob, deck.deckName);
      track('anon_deck_refetched', { outcome: 'downloaded' });
    } catch (error) {
      const failure = noticeFor(error);
      setNotice(failure);
      track('anon_deck_refetched', { outcome: failure });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={formStyles.lastDeck}>
      {lastDeck != null && (
        <>
          <p id={lineId} className={formStyles.resumeText}>
            <Trans
              t={t}
              i18nKey="line"
              values={{
                name: displayName(lastDeck.deckName),
                time: new Date(lastDeckExpiresAt(lastDeck)).toLocaleString(
                  i18n.language,
                  { weekday: 'short', hour: '2-digit', minute: '2-digit' }
                ),
              }}
              components={{
                name: (
                  <span className={formStyles.lastDeckName} data-hj-suppress />
                ),
              }}
            />
          </p>
          <button
            ref={buttonRef}
            type="button"
            className={`${sharedStyles.btnSecondary} ${sharedStyles.btnInline}`}
            disabled={downloading}
            aria-busy={downloading}
            aria-describedby={lineId}
            onClick={() => void handleDownload(lastDeck)}
          >
            {downloading ? t('downloading') : t('download')}
          </button>
        </>
      )}
      <p
        ref={noticeRef}
        className={formStyles.resumeText}
        role="status"
        tabIndex={-1}
      >
        {notice == null ? '' : t(NOTICE_KEYS[notice])}
      </p>
    </div>
  );
}

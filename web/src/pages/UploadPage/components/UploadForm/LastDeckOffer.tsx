import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { track } from '../../../../lib/analytics/track';
import { RecoveryStorageBusyError } from '../../../../lib/backend/Backend';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import {
  getLastDeckStore,
  lastDeckExpiresAt,
  type LastDeck,
} from '../../../../lib/upload/lastDeck';
import sharedStyles from '../../../../styles/shared.module.css';
import formStyles from './UploadForm.module.css';

interface LastDeckOfferProps {
  visible: boolean;
}

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

export function LastDeckOffer({ visible }: Readonly<LastDeckOfferProps>) {
  const { t, i18n } = useTranslation('lastDeck');
  const [lastDeck, setLastDeck] = useState<LastDeck | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getLastDeckStore()
      .load()
      .then((deck) => {
        if (!cancelled) setLastDeck(deck);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible || lastDeck == null) return null;

  const handleDownload = async () => {
    setDownloading(true);
    setStorageBusy(false);
    try {
      const deck = await get2ankiApi().getAnonymousRecoveredDeck(
        lastDeck.recoveryToken
      );
      if (deck == null) {
        await getLastDeckStore().clear();
        setLastDeck(null);
        track('anon_deck_refetched', { outcome: 'expired' });
        return;
      }
      saveDeck(deck, lastDeck.deckName);
      track('anon_deck_refetched', { outcome: 'downloaded' });
    } catch (error) {
      if (error instanceof RecoveryStorageBusyError) {
        setStorageBusy(true);
        track('anon_deck_refetched', { outcome: 'busy' });
      } else {
        track('anon_deck_refetched', { outcome: 'failed' });
      }
    } finally {
      setDownloading(false);
    }
  };

  const until = new Date(lastDeckExpiresAt(lastDeck)).toLocaleString(
    i18n.language,
    { weekday: 'short', hour: '2-digit', minute: '2-digit' }
  );

  return (
    <div className={formStyles.lastDeck}>
      <p className={formStyles.resumeText}>
        <Trans
          t={t}
          i18nKey="line"
          values={{ name: displayName(lastDeck.deckName), time: until }}
          components={{
            name: <span className={formStyles.lastDeckName} data-hj-suppress />,
          }}
        />
      </p>
      <button
        type="button"
        className={`${sharedStyles.btnSecondary} ${sharedStyles.btnInline}`}
        disabled={downloading}
        aria-busy={downloading}
        onClick={() => void handleDownload()}
      >
        {downloading ? t('downloading') : t('download')}
      </button>
      {storageBusy && (
        <p className={formStyles.resumeText} role="status">
          {t('storageBusy')}
        </p>
      )}
    </div>
  );
}

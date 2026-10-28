import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../../lib/analytics/track';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import { usePassPrices } from '../../../../lib/hooks/usePassPrices';
import { clearThinDeckResume } from './thinDeckResume';
import styles from './ThinDeckAiOffer.module.css';

type Card = { front: string; back: string };
type Phase =
  | { name: 'idle' }
  | { name: 'loading' }
  | { name: 'preview'; cards: Card[] }
  | { name: 'unavailable' };

interface ThinDeckAiOfferProps {
  file: File;
  cardCount: number;
  isPaying: boolean;
  busy?: boolean;
  onMakeFullDeck: () => void;
  onBeforeCheckout: () => Promise<void>;
}

const SURFACE = 'thin-deck';

export function ThinDeckAiOffer({
  file,
  cardCount,
  isPaying,
  busy = false,
  onMakeFullDeck,
  onBeforeCheckout,
}: Readonly<ThinDeckAiOfferProps>) {
  const { t } = useTranslation('thinDeckAi');
  const prices = usePassPrices();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState(false);
  const resultRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (phase.name === 'preview' || phase.name === 'unavailable') {
      resultRef.current?.focus();
    }
  }, [phase.name]);

  useEffect(() => {
    track('thin_deck_ai_offer_shown', { cards: cardCount });
  }, [cardCount]);

  const preview = async () => {
    track('thin_deck_ai_optin_clicked', { cards: cardCount });
    setPhase({ name: 'loading' });
    const result = await get2ankiApi().previewThinDeckAi(file);
    setPhase(
      result.kind === 'preview'
        ? { name: 'preview', cards: result.cards }
        : { name: 'unavailable' }
    );
  };

  // A paying person's tap is recorded by the page once the file goes out.
  const unlock = async () => {
    if (isPaying) {
      onMakeFullDeck();
      return;
    }
    track('thin_deck_ai_unlock_clicked', { plan: 'day_pass' });
    setCheckoutError(false);
    setCheckoutPending(true);
    try {
      await onBeforeCheckout();
      const result = await get2ankiApi().startPassCheckout(
        '24h',
        undefined,
        SURFACE
      );
      if ('url' in result) {
        globalThis.location.href = result.url;
        return;
      }
      clearThinDeckResume();
      setCheckoutError(true);
    } finally {
      setCheckoutPending(false);
    }
  };

  const unlockLabel = (): string => {
    if (busy) return t('common:upload.form.checkingAccount');
    return isPaying
      ? t('unlockPaying')
      : t('unlockFree', { price: prices['24h'] });
  };

  return (
    <section className={styles.offer} aria-label={t('ariaLabel')}>
      {phase.name === 'idle' && (
        <>
          <p className={styles.lead}>{t('lead')}</p>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void preview()}
          >
            {t('cta')}
          </button>
          <p className={styles.note}>{t('consent')}</p>
        </>
      )}
      {phase.name === 'loading' && (
        <p className={styles.lead} role="status">
          {t('loading')}
        </p>
      )}
      {phase.name === 'unavailable' && (
        <p ref={resultRef} tabIndex={-1} className={styles.lead} role="status">
          {t('unavailable')}
        </p>
      )}
      {phase.name === 'preview' && (
        <>
          <p ref={resultRef} tabIndex={-1} className={styles.lead}>
            {t('heading')}
          </p>
          <ul className={styles.list}>
            {phase.cards.map((card, index) => (
              <li key={`${index}-${card.front}`} className={styles.row}>
                <div className={styles.cell}>
                  <span className={styles.label}>{t('front')}</span>
                  {card.front}
                </div>
                <div className={styles.cell}>
                  <span className={styles.label}>{t('back')}</span>
                  {card.back}
                </div>
              </li>
            ))}
          </ul>
          {checkoutError && (
            <p className={styles.error} role="alert">
              {t('checkoutError')}
            </p>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={checkoutPending || busy}
            aria-busy={busy}
            onClick={() => void unlock()}
          >
            {unlockLabel()}
          </button>
          <p className={styles.note}>
            {isPaying ? t('unlockPayingNote') : t('unlockFreeNote')}
          </p>
        </>
      )}
    </section>
  );
}

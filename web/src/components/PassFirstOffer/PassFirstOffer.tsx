import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { purchaseConflictMessage } from '../../lib/checkout/purchaseConflictMessage';
import { usePassPrices } from '../../lib/hooks/usePassPrices';
import styles from './PassFirstOffer.module.css';

type PassKind = '24h' | '120d';

// Same vocabularies the limit wall already reports, so one query reads both.
const UPGRADE_PLAN: Record<PassKind, string> = {
  '24h': 'day_pass',
  '120d': 'semester_pass',
};

const PASS_CLICK_PLAN: Record<PassKind, string> = {
  '24h': 'day',
  '120d': 'semester',
};

const PASS_ORDER: readonly PassKind[] = ['120d', '24h'];

const PASS_COPY: Record<
  PassKind,
  { label: string; hint: string; badge: string }
> = {
  '120d': {
    label: 'semester',
    hint: 'semesterHint',
    badge: 'common:pricing.pass.bestValue',
  },
  '24h': {
    label: 'day',
    hint: 'dayHint',
    badge: 'common:pricing.pass.mostPopular',
  },
};

interface PassFirstOfferProps {
  readonly surface: string;
  readonly headline?: string;
  readonly body?: string;
  readonly note?: string;
  // Which pass is the primary button. The pass-first walls lead with the
  // Semester Pass; the upload page's default wall leads with the Day Pass,
  // matching the Day Pass /limit features when pass-first is off.
  readonly lead?: PassKind;
  // Free sign-up, sign-in or a plans link, rendered as plain text links below
  // the passes.
  readonly children?: ReactNode;
}

// Both passes side by side, one of them primary, and anything free as a text
// link underneath.
export function PassFirstOffer({
  surface,
  headline,
  body,
  note,
  lead = '120d',
  children,
}: PassFirstOfferProps) {
  const { t, i18n } = useTranslation('passFirst');
  const prices = usePassPrices();
  const [pending, setPending] = useState<PassKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buy = async (kind: PassKind) => {
    track('paywall_upgrade_clicked', { surface, plan: UPGRADE_PLAN[kind] });
    track('paywall_pass_clicked', { surface, plan: PASS_CLICK_PLAN[kind] });
    setError(null);
    setPending(kind);
    try {
      const result = await get2ankiApi().startPassCheckout(
        kind,
        undefined,
        surface
      );
      if ('url' in result) {
        // Leaving for Stripe: keep the buttons disabled until the page goes.
        globalThis.location.href = result.url;
        return;
      }
      setError(
        result.status === 'conflict'
          ? purchaseConflictMessage(t, result, i18n.language)
          : t('checkoutError')
      );
    } catch {
      setError(t('checkoutError'));
    }
    setPending(null);
  };

  return (
    <section className={styles.offer} aria-label={t('aria')}>
      {headline && <p className={styles.headline}>{headline}</p>}
      {body && <p className={styles.body}>{body}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.plans}>
        {(lead === '120d' ? PASS_ORDER : [...PASS_ORDER].reverse()).map(
          (kind) => (
            <button
              key={kind}
              type="button"
              className={kind === lead ? styles.primary : styles.secondary}
              disabled={pending != null}
              onClick={() => void buy(kind)}
            >
              <span className={styles.planLabel}>
                {pending === kind
                  ? t('starting')
                  : t(PASS_COPY[kind].label, { price: prices[kind] })}
              </span>
              <span className={styles.planHint}>{t(PASS_COPY[kind].hint)}</span>
              <span className={styles.planBadge}>
                {t(PASS_COPY[kind].badge)}
              </span>
            </button>
          )
        )}
      </div>
      {note && <p className={styles.note}>{note}</p>}
      {children != null && <p className={styles.links}>{children}</p>}
    </section>
  );
}

export default PassFirstOffer;

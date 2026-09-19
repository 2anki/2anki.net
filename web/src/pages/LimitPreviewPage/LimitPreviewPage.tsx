import { useTranslation } from 'react-i18next';
import sharedStyles from '../../styles/shared.module.css';
import {
  LimitWall,
  type PassKind,
  type WallOrder,
} from '../LimitPage/LimitWall';
import previewStyles from './LimitPreviewPage.module.css';

const noop = () => undefined;

interface Variant {
  label: string;
  note: string;
  order: WallOrder;
  pendingPass: PassKind | null;
  showError: boolean;
}

const variants: Variant[] = [
  {
    label: 'A — passes first (previous order)',
    note: 'Free signed-in user at the monthly cap. Day, Week and Semester lead; Unlimited follows.',
    order: 'passes-first',
    pendingPass: null,
    showError: false,
  },
  {
    label: 'B — Unlimited first',
    note: 'Same user. The subscription leads; the passes follow. This is the order the limit page uses.',
    order: 'unlimited-first',
    pendingPass: null,
    showError: false,
  },
  {
    label: 'A — Semester redirecting',
    note: 'Semester Pass clicked; checkout is opening. Only that card is disabled.',
    order: 'passes-first',
    pendingPass: '120d',
    showError: false,
  },
  {
    label: 'B — Semester redirecting',
    note: 'Same state with Unlimited first.',
    order: 'unlimited-first',
    pendingPass: '120d',
    showError: false,
  },
  {
    label: 'A — checkout error',
    note: 'Checkout could not start; the alert appears above the passes and scrolls into view.',
    order: 'passes-first',
    pendingPass: null,
    showError: true,
  },
  {
    label: 'B — checkout error',
    note: 'Same error with Unlimited first: the alert stays above the passes, next to the buttons.',
    order: 'unlimited-first',
    pendingPass: null,
    showError: true,
  },
];

export default function LimitPreviewPage() {
  const { t } = useTranslation('accountx');

  return (
    <div className={previewStyles.outer}>
      <header className={previewStyles.outerHeader}>
        <h1 className={sharedStyles.title}>Limit wall — variants</h1>
        <p className={sharedStyles.subtitle}>
          Visual preview only. Not linked from navigation. Not gated by auth.
          Paid and lifetime users never reach this page. Use the browser’s
          responsive mode at 375px to judge the stacked length.
        </p>
      </header>

      <div className={previewStyles.grid}>
        {variants.map((variant) => (
          <article key={variant.label} className={previewStyles.variant}>
            <header className={previewStyles.variantHeader}>
              <h2 className={previewStyles.variantLabel}>{variant.label}</h2>
              <p className={previewStyles.variantNote}>{variant.note}</p>
            </header>
            <div className={previewStyles.frame}>
              <LimitWall
                order={variant.order}
                pendingPass={variant.pendingPass}
                onPass={noop}
                passError={variant.showError ? t('limit.checkoutError') : null}
                unlimitedHref="/pricing?source=limit-wall"
                onUnlimitedClick={(event) => event.preventDefault()}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

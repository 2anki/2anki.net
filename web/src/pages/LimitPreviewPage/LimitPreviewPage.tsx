import { useTranslation } from 'react-i18next';
import sharedStyles from '../../styles/shared.module.css';
import { LimitWall, type PassKind } from '../LimitPage/LimitWall';
import previewStyles from './LimitPreviewPage.module.css';

const noop = () => undefined;

interface Variant {
  label: string;
  note: string;
  unlimitedPrice?: string;
  pendingPass: PassKind | null;
  showError: boolean;
}

const variants: Variant[] = [
  {
    label: 'Passes first, Pro price known',
    note: 'Free signed-in user at the monthly cap. Day, Week and Semester lead; Pro is one line with its monthly price.',
    unlimitedPrice: '$7.99',
    pendingPass: null,
    showError: false,
  },
  {
    label: 'Passes first, no Pro price',
    note: 'Same user with the Pro price flag off or the price unreadable.',
    pendingPass: null,
    showError: false,
  },
  {
    label: 'Semester redirecting',
    note: 'Semester Pass clicked; checkout is opening. Only that card is disabled.',
    unlimitedPrice: '$7.99',
    pendingPass: '120d',
    showError: false,
  },
  {
    label: 'Checkout error',
    note: 'Checkout could not start; the alert appears above the passes and scrolls into view.',
    unlimitedPrice: '$7.99',
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
                pendingPass={variant.pendingPass}
                onPass={noop}
                passError={variant.showError ? t('limit.checkoutError') : null}
                unlimitedHref="/pricing?source=limit-wall"
                unlimitedPrice={variant.unlimitedPrice}
                onUnlimitedClick={(event) => event.preventDefault()}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

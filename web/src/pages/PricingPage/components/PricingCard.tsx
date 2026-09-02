import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import styles from '../PricingPage.module.css';

interface PricingCardProp {
  price?: string;
  priceSuffix?: string;
  priceRange?: boolean;
  priceChip?: string;
  hidePriceLine?: boolean;
  title: string;
  badge?: string;
  badgeMuted?: boolean;
  horizonCaption?: string;
  valueCaption?: string;
  benefits: string[];
  link?: string;
  linkText?: string;
  onLinkClick?: () => void;
  onAction?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  comingSoon?: boolean;
  variant?: 'primary' | 'outline';
  caption?: string;
  learnMoreHref?: string;
  className?: string;
}

function CheckIcon() {
  return (
    <svg
      className={styles.benefitIcon}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PricingCard({
  price,
  priceSuffix,
  priceRange,
  priceChip,
  hidePriceLine,
  title,
  badge,
  badgeMuted,
  horizonCaption,
  valueCaption,
  benefits,
  linkText,
  link,
  onLinkClick,
  onAction,
  actionLabel,
  actionDisabled,
  comingSoon,
  variant = 'primary',
  caption,
  learnMoreHref,
  className,
}: Readonly<PricingCardProp>) {
  const { t } = useTranslation();
  const baseCardClass = comingSoon ? styles.cardComingSoon : styles.card;
  const cardClass =
    className == null ? baseCardClass : `${baseCardClass} ${className}`;
  const buttonClass =
    variant === 'outline' ? styles.cardButtonOutline : styles.cardButton;
  const showButton = onAction != null && actionLabel != null;
  const showLink = !showButton && link != null && linkText != null;

  let priceNode: ReactNode = null;
  if (!hidePriceLine) {
    if (price != null) {
      const priceLineClass = priceRange
        ? `${styles.cardPriceLine} ${styles.cardPriceLineRange}`
        : styles.cardPriceLine;
      priceNode = (
        <span className={priceLineClass}>
          <span className={styles.cardPrice}>{price}</span>
          {priceSuffix != null && (
            <span className={styles.cardPriceSuffix}>{priceSuffix}</span>
          )}
        </span>
      );
    } else if (priceChip != null) {
      priceNode = <span className={styles.cardPriceChip}>{priceChip}</span>;
    }
  }

  const badgeClass = badgeMuted ? styles.cardBadgeMuted : styles.cardBadge;

  return (
    <div className={cardClass}>
      {badge != null && <span className={badgeClass}>{badge}</span>}
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
        {priceNode}
        {horizonCaption != null && (
          <p className={styles.priceCaption}>{horizonCaption}</p>
        )}
        {valueCaption != null && (
          <p className={styles.priceCaption}>{valueCaption}</p>
        )}
      </div>
      <div className={styles.cardBody}>
        {benefits.map((benefit) => (
          <p key={benefit} className={styles.benefit}>
            <CheckIcon />
            <span>{benefit}</span>
          </p>
        ))}
      </div>
      {(showButton || showLink || caption != null || learnMoreHref != null) && (
        <div className={styles.cardFooter}>
          {showButton && (
            <button
              type="button"
              className={buttonClass}
              onClick={onAction}
              disabled={actionDisabled}
            >
              {actionLabel}
            </button>
          )}
          {showLink && (
            <a href={link} className={buttonClass} onClick={onLinkClick}>
              {linkText}
            </a>
          )}
          {caption != null && <p className={styles.cardCaption}>{caption}</p>}
          {learnMoreHref != null && (
            <a
              href={learnMoreHref}
              className={styles.cardLearnMore}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('pricing.card.howSyncWorks')}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

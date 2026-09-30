import { useTranslation } from 'react-i18next';
import styles from '../PricingPage.module.css';

export interface PricingEntitlement {
  subscriber?: boolean;
  patreon?: boolean;
  planSource?: 'stripe' | 'apple' | 'lifetime' | null;
  passKind?: '24h' | '7d' | '120d' | 'unlimited' | null;
  passExpiresAt?: string | null;
}

const PASS_LABELS: Record<string, string> = {
  '24h': 'Day Pass',
  '7d': 'Week Pass',
  '120d': 'Semester Pass',
  unlimited: 'Pro',
};

// A pass runs out, so a forward upgrade to Pro is a real choice and the
// purchase options stay. Lifetime, an Apple subscription and a live Stripe
// subscription are ongoing: there is nothing on this page for those people to
// buy, and offering it is how someone ends up paying twice.
export function ownsOngoingAccess(
  entitlement: PricingEntitlement | undefined
): boolean {
  if (entitlement == null) return false;
  if (entitlement.patreon === true) return true;
  if (entitlement.planSource === 'apple') return true;
  return entitlement.subscriber === true && entitlement.passKind == null;
}

export function activePassKind(
  entitlement: PricingEntitlement | undefined
): string | null {
  if (entitlement?.passKind == null) return null;
  if (entitlement.passExpiresAt == null) return null;
  return new Date(entitlement.passExpiresAt).getTime() > Date.now()
    ? entitlement.passKind
    : null;
}

export function OwnedPlanNotice({
  entitlement,
}: Readonly<{ entitlement: PricingEntitlement | undefined }>) {
  const { t } = useTranslation('account');

  const passKind = activePassKind(entitlement);
  if (passKind != null) {
    return (
      <output className={styles.contextBanner}>
        {t('accessBanner.active', {
          passLabel: PASS_LABELS[passKind] ?? passKind,
          date: new Date(entitlement!.passExpiresAt!).toLocaleDateString(),
        })}
      </output>
    );
  }

  if (!ownsOngoingAccess(entitlement)) return null;

  if (entitlement?.patreon === true) {
    return (
      <output className={styles.contextBanner}>
        <strong>Lifetime</strong> {t('planDetails.lifetimeMeta')}{' '}
        <a href="/account">{t('checkout.goToAccount')}</a>
      </output>
    );
  }

  const appleSuffix =
    entitlement?.planSource === 'apple'
      ? ` · ${t('subscription.billedThroughApple')}`
      : '';

  return (
    <output className={styles.contextBanner}>
      {t('checkout.youreOnUnlimited')}
      {appleSuffix}. <a href="/account">{t('checkout.goToAccount')}</a>
    </output>
  );
}

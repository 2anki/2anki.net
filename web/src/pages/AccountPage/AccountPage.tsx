import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { SkeletonPage } from '../../components/Skeleton/Skeleton';
import { useSubscriptionStatus } from './hooks';
import {
  UserProfile,
  PlanDetails,
  ClaimSubscription,
  SubscriptionManagement,
  AccountDeletion,
  LogOutEverywhere,
} from './components';
import { LanguagePicker } from '../../components/LanguagePicker/LanguagePicker';
import sharedStyles from '../../styles/shared.module.css';
import styles from './AccountPage.module.css';

export default function AccountPage() {
  const { t } = useTranslation();
  const { isLoading, data, refetch } = useUserLocals();
  const { subscriptionType, hasActivePlan } = useSubscriptionStatus(
    data?.locals
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const justSubscribed = searchParams.get('subscribed') === '1';
  const justVerified = searchParams.get('verified') === '1';
  const justChangedEmail = searchParams.get('email_changed') === '1';

  const dismissParam = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    setSearchParams(next, { replace: true });
  };

  if (isLoading) return <SkeletonPage rows={4} />;

  if (!data?.user?.email) {
    globalThis.location.href = '/login';
    return null;
  }

  const { user, locals } = data;
  const canClaimSubscription = !hasActivePlan;

  return (
    <div className={styles.page}>
      <header className={sharedStyles.pageHeader}>
        <h1 className={sharedStyles.title}>{t('account.title')}</h1>
      </header>

      {justSubscribed && (
        <div
          className={sharedStyles.alertSuccess}
          role="status"
          aria-live="polite"
        >
          <p>
            <strong>{t('account.subscribed')}</strong>
          </p>
          <button
            type="button"
            className={sharedStyles.btnGhost}
            onClick={() => dismissParam('subscribed')}
          >
            {t('account.dismiss')}
          </button>
        </div>
      )}

      {justVerified && (
        <div
          className={sharedStyles.alertSuccess}
          role="status"
          aria-live="polite"
        >
          <p>{t('account.emailVerified')}</p>
          <button
            type="button"
            className={sharedStyles.btnGhost}
            onClick={() => dismissParam('verified')}
          >
            {t('account.dismiss')}
          </button>
        </div>
      )}

      {justChangedEmail && (
        <div
          className={sharedStyles.alertSuccess}
          role="status"
          aria-live="polite"
        >
          <p>{t('account.emailChanged')}</p>
          <button
            type="button"
            className={sharedStyles.btnGhost}
            onClick={() => dismissParam('email_changed')}
          >
            {t('account.dismiss')}
          </button>
        </div>
      )}

      <UserProfile user={user} />

      <section className={styles.section}>
        <LanguagePicker variant="labeled" />
      </section>

      <PlanDetails subscriptionType={subscriptionType} />

      {canClaimSubscription && <ClaimSubscription />}

      <SubscriptionManagement
        user={user}
        locals={locals}
        hasActivePlan={hasActivePlan}
        onRefetch={refetch}
      />

      <LogOutEverywhere />

      <AccountDeletion />

      <footer className={styles.pageFooter}>
        <a href="mailto:support@2anki.net" className={styles.footerLink}>
          support@2anki.net
        </a>
      </footer>
    </div>
  );
}

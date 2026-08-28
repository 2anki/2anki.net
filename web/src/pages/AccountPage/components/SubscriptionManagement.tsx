import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubscriptionCancellation } from '../hooks/useSubscriptionCancellation';
import { usePerSubscriptionCancellation } from '../hooks/usePerSubscriptionCancellation';
import { usePauseSubscription } from '../hooks/usePauseSubscription';
import { useStripeSubscriptions } from '../../../lib/hooks/useStripeSubscriptions';
import { StripeSubscriptionSummary } from '../../../lib/backend/getSubscriptionStatus';
import { track } from '../../../lib/analytics/track';
import { STRIPE_CUSTOMER_PORTAL_URL } from '../../../lib/stripePortal';
import { CancelFlow, isLifecycleReason } from './CancelFlow';
import { CancellationReason } from './cancellationReasons';
import { ClaimSubscription } from './ClaimSubscription';
import styles from '../AccountPage.module.css';
import sharedStyles from '../../../styles/shared.module.css';

type CancellationReasonInput = CancellationReason | '';

const SECONDS_PER_DAY = 24 * 60 * 60;
const MIN_TENURE_DAYS_TO_PAUSE = 30;

const tenureDaysOf = (sub: StripeSubscriptionSummary): number => {
  if (sub.created == null) return 0;
  return Math.floor((Date.now() / 1000 - sub.created) / SECONDS_PER_DAY);
};

const isAnnual = (sub: StripeSubscriptionSummary): boolean =>
  sub.plan?.interval === 'year';

interface User {
  email: string;
  name?: string;
}

interface LocalsData {
  subscriber?: boolean;
  planSource?: 'stripe' | 'apple' | 'lifetime' | null;
  subscriptionInfo?: {
    linked_email?: string;
    email?: string;
  };
}

interface SubscriptionManagementProps {
  readonly user: User;
  readonly locals: LocalsData;
  readonly hasActivePlan: boolean;
  readonly onRefetch: () => Promise<any>;
}

const canRenderSubscriptionSection = (locals: LocalsData): boolean =>
  Boolean(locals?.subscriber) || locals?.subscriptionInfo?.email != null;

const formatDate = (seconds: number | null, unknownLabel: string): string => {
  if (!seconds) return unknownLabel;
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const V2_MONTHLY_AMOUNT = 799;
const V2_YEARLY_AMOUNT = 6400;

const isLegacyRate = (sub: StripeSubscriptionSummary): boolean => {
  const plan = sub.plan;
  if (plan?.amount == null) return false;
  const v2Amount =
    plan.interval === 'year' ? V2_YEARLY_AMOUNT : V2_MONTHLY_AMOUNT;
  return plan.amount < v2Amount;
};

const formatPlan = (sub: StripeSubscriptionSummary): string | null => {
  const plan = sub.plan;
  if (plan?.amount == null || !plan?.currency) return null;
  const price = (plan.amount / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: plan.currency.toUpperCase(),
  });
  return plan.interval ? `${price} / ${plan.interval}` : price;
};

const byNextChargeAsc = (
  a: StripeSubscriptionSummary,
  b: StripeSubscriptionSummary
): number => (a.current_period_end ?? 0) - (b.current_period_end ?? 0);

function MultipleSubscriptionsRow({
  sub,
  confirmingSubId,
  errorSubId,
  cancelError,
  isCancelling,
  onOpenConfirm,
  onConfirmCancel,
  onDismiss,
}: {
  readonly sub: StripeSubscriptionSummary;
  readonly confirmingSubId: string | null;
  readonly errorSubId: string | null;
  readonly cancelError: string;
  readonly isCancelling: boolean;
  readonly onOpenConfirm: (id: string) => void;
  readonly onConfirmCancel: (id: string) => void;
  readonly onDismiss: () => void;
}) {
  const { t } = useTranslation('account');
  const fmt = (seconds: number | null) =>
    formatDate(seconds, t('subscription.unknownDate'));
  const planLabel = formatPlan(sub);
  const isScheduled = sub.cancel_at_period_end;
  const isConfirming = confirmingSubId === sub.id;

  if (isScheduled) {
    return (
      <div className={styles.section}>
        <p className={styles.statusLine}>
          {planLabel ?? t('subscription.premium')} ·{' '}
          {t('subscription.endsPrefix')} <strong>{fmt(sub.cancel_at)}</strong>.{' '}
          {t('subscription.accessContinues')}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <p className={styles.statusLine}>
        <span style={{ fontWeight: 500 }}>
          {planLabel ?? t('subscription.premium')}
        </span>{' '}
        · {t('subscription.renewsPrefix')}{' '}
        <strong>{fmt(sub.current_period_end)}</strong>
      </p>
      {!isConfirming && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onOpenConfirm(sub.id)}
          >
            {t('subscription.cancelThisPlan')}
          </button>
        </div>
      )}
      {isConfirming && (
        <div
          className={styles.dangerSection}
          role="group"
          aria-label={t('subscription.cancelThisPlanNow')}
        >
          <p className={styles.dangerTitle}>
            {t('subscription.cancelThisPlanNow')}
          </p>
          <p className={styles.dangerNotice}>
            {planLabel
              ? t('subscription.cancelPlanNoticeWithLabel', {
                  planLabel,
                  date: fmt(sub.current_period_end),
                })
              : t('subscription.cancelPlanNotice')}
          </p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => onConfirmCancel(sub.id)}
              disabled={isCancelling}
            >
              {isCancelling
                ? t('subscription.processing')
                : t('subscription.cancelThisPlan')}
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={onDismiss}
              disabled={isCancelling}
            >
              {t('subscription.keepIt')}
            </button>
          </div>
        </div>
      )}
      {errorSubId === sub.id && cancelError && (
        <p className={styles.helpDanger}>{cancelError}</p>
      )}
    </div>
  );
}

function MultipleSubscriptions({
  subscriptions,
  onRefetch,
}: {
  readonly subscriptions: StripeSubscriptionSummary[];
  readonly onRefetch: () => Promise<unknown>;
}) {
  const { t } = useTranslation('account');
  const {
    confirmingSubId,
    errorSubId,
    cancelError,
    isCancelling,
    openConfirm,
    dismissConfirm,
    confirmCancel,
  } = usePerSubscriptionCancellation(() => {
    void onRefetch();
  });

  const ordered = [...subscriptions].sort(byNextChargeAsc);

  return (
    <section className={styles.section}>
      <p className={styles.scheduledBadge}>
        {t('subscription.multipleActive', { count: subscriptions.length })}
      </p>
      {ordered.map((sub) => (
        <MultipleSubscriptionsRow
          key={sub.id}
          sub={sub}
          confirmingSubId={confirmingSubId}
          errorSubId={errorSubId}
          cancelError={cancelError}
          isCancelling={isCancelling}
          onOpenConfirm={openConfirm}
          onConfirmCancel={confirmCancel}
          onDismiss={dismissConfirm}
        />
      ))}
    </section>
  );
}

function AppleSubscriptionManagement() {
  const { t } = useTranslation('account');
  return (
    <section className={styles.section}>
      <p className={styles.statusLine}>
        Unlimited · {t('subscription.billedThroughApple')}
      </p>
      <p className={sharedStyles.smallDescription}>
        {t('subscription.appleManageNotice')}
      </p>
    </section>
  );
}

function PausedState({
  subscription,
  planLabel,
  isResuming,
  isCancelling,
  resumeError,
  onResume,
  onCancel,
}: {
  readonly subscription: StripeSubscriptionSummary;
  readonly planLabel: string | null;
  readonly isResuming: boolean;
  readonly isCancelling: boolean;
  readonly resumeError: string;
  readonly onResume: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation('account');
  const resumeDate = formatDate(
    subscription.paused_until,
    t('subscription.unknownDate')
  );
  const planText = planLabel ?? t('subscription.yourPlan');

  return (
    <>
      <p className={styles.scheduledBadge}>
        {t('subscription.pausedResumesPrefix')} <strong>{resumeDate}</strong>
      </p>
      <p className={styles.dangerNotice}>
        {t('subscription.pausedNotice', { date: resumeDate, plan: planText })}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onResume}
          disabled={isResuming}
        >
          {isResuming
            ? t('subscription.resuming')
            : t('subscription.resumeNow')}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onCancel}
          disabled={isCancelling}
        >
          {isCancelling
            ? t('subscription.processing')
            : t('subscription.cancelSubscription')}
        </button>
      </div>
      {resumeError && <p className={styles.helpDanger}>{resumeError}</p>}
    </>
  );
}

export function SubscriptionManagement(props: SubscriptionManagementProps) {
  const { locals } = props;

  if (!canRenderSubscriptionSection(locals)) {
    return null;
  }

  if (locals.planSource === 'apple') {
    return <AppleSubscriptionManagement />;
  }

  return <StripeSubscriptionManagement {...props} />;
}

function StripeSubscriptionManagement({
  locals,
  onRefetch,
}: SubscriptionManagementProps) {
  const { t } = useTranslation('account');
  const fmt = (seconds: number | null) =>
    formatDate(seconds, t('subscription.unknownDate'));

  const canRender = canRenderSubscriptionSection(locals);
  const stripeStatus = useStripeSubscriptions(canRender);

  const refetchAll = async () => {
    await Promise.all([onRefetch(), stripeStatus.refetch()]);
  };

  const {
    cancelUserSubscription,
    submitFeedback,
    isCancelling,
    cancelError,
    cancelSuccess,
  } = useSubscriptionCancellation(refetchAll);

  const {
    pauseSubscriptionForMonths,
    resumeSubscriptionNow,
    isPausing,
    isResuming,
    pauseError,
    resumeError,
  } = usePauseSubscription(refetchAll);

  const {
    cancelError: perSubCancelError,
    isCancelling: isCancellingPerSub,
    confirmCancel: confirmPerSubCancel,
  } = usePerSubscriptionCancellation(() => {
    void refetchAll();
  });

  const [confirming, setConfirming] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (wasConfirming.current && !confirming) {
      cancelButtonRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  const { view } = stripeStatus;
  const shownSubId =
    view.kind === 'past_due' || view.kind === 'cancelled'
      ? view.subscription.id
      : null;

  useEffect(() => {
    if (view.kind === 'past_due') {
      track('subscription_past_due_shown', { subscription_id: shownSubId });
    } else if (view.kind === 'cancelled') {
      track('subscription_ended_shown', { subscription_id: shownSubId });
    }
  }, [view.kind, shownSubId]);

  if (!canRender) {
    return null;
  }

  const { activeSubscriptions } = stripeStatus;
  const hasMultipleActive = activeSubscriptions.length > 1;

  const activeSub = view.kind === 'active' ? view.subscription : null;
  const pastDueSub = view.kind === 'past_due' ? view.subscription : null;
  const pauseEligible =
    activeSub != null &&
    !isAnnual(activeSub) &&
    tenureDaysOf(activeSub) >= MIN_TENURE_DAYS_TO_PAUSE &&
    !hasMultipleActive;

  const handleOpenCancelFlow = () => {
    if (activeSub != null) {
      track('subscription_cancel_started', {
        tenure_days: tenureDaysOf(activeSub),
        interval: isAnnual(activeSub) ? 'year' : 'month',
      });
    }
    setConfirming(true);
  };

  const handleCancelFromFlow = (
    reason: CancellationReasonInput,
    comment: string
  ) => {
    if (reason) {
      submitFeedback(reason, comment);
    }
    if (pauseEligible && isLifecycleReason(reason)) {
      track('subscription_pause_offer_declined', {
        reason,
        tenure_days: activeSub == null ? 0 : tenureDaysOf(activeSub),
      });
    }
    cancelUserSubscription(
      'period_end',
      activeSub?.current_period_end,
      reason || undefined
    );
    setConfirming(false);
  };

  const handleKeep = (reason: CancellationReasonInput, comment: string) => {
    if (reason) {
      submitFeedback(reason, comment);
    }
    setConfirming(false);
  };

  const handleCancelDuringPause = () => {
    track('subscription_cancelled_during_pause');
    cancelUserSubscription('immediate');
  };

  const handleManageBilling = () => {
    if (activeSub != null) {
      track('subscription_manage_billing_clicked', {
        interval: isAnnual(activeSub) ? 'year' : 'month',
      });
    }
  };

  const handleManageBillingPastDue = () => {
    if (pastDueSub != null) {
      track('subscription_manage_billing_clicked', {
        from: 'past_due',
        interval: isAnnual(pastDueSub) ? 'year' : 'month',
      });
    }
  };

  const handlePastDueCancel = (
    reason: CancellationReasonInput,
    comment: string
  ) => {
    if (reason) {
      submitFeedback(reason, comment);
    }
    if (pastDueSub != null) {
      confirmPerSubCancel(pastDueSub.id);
    }
    setConfirming(false);
  };

  return (
    <section className={styles.section}>
      {hasMultipleActive && (
        <MultipleSubscriptions
          subscriptions={activeSubscriptions}
          onRefetch={refetchAll}
        />
      )}

      {!hasMultipleActive && canRender && (
        <div>
          {view.kind === 'active' && (
            <>
              <p className={styles.statusLine}>
                {formatPlan(view.subscription) ?? t('subscription.premium')} ·{' '}
                {t('subscription.renewsPrefix')}{' '}
                <strong>{fmt(view.subscription.current_period_end)}</strong>
              </p>
              {isLegacyRate(view.subscription) && (
                <p className={styles.legacyNote}>
                  {t('subscription.legacyForfeit')}
                </p>
              )}
              {!confirming && (
                <>
                  <div className={styles.actions}>
                    <a
                      className={styles.manageBillingButton}
                      href={STRIPE_CUSTOMER_PORTAL_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleManageBilling}
                    >
                      {t('subscription.updatePayment')}
                    </a>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      ref={cancelButtonRef}
                      onClick={handleOpenCancelFlow}
                      disabled={isCancelling}
                    >
                      {t('subscription.cancelSubscription')}
                    </button>
                  </div>
                  <p className={sharedStyles.smallDescription}>
                    {t('subscription.updatePaymentHelp')}
                  </p>
                </>
              )}
              {confirming && (
                <CancelFlow
                  planLabel={formatPlan(view.subscription)}
                  tenureDays={tenureDaysOf(view.subscription)}
                  pauseEligible={pauseEligible}
                  isCancelling={isCancelling}
                  isPausing={isPausing}
                  pauseError={pauseError}
                  onCancel={handleCancelFromFlow}
                  onKeep={handleKeep}
                  onPause={(months) => pauseSubscriptionForMonths(months)}
                />
              )}
            </>
          )}

          {view.kind === 'paused' && (
            <PausedState
              subscription={view.subscription}
              planLabel={formatPlan(view.subscription)}
              isResuming={isResuming}
              isCancelling={isCancelling}
              resumeError={resumeError}
              onResume={resumeSubscriptionNow}
              onCancel={handleCancelDuringPause}
            />
          )}

          {view.kind === 'past_due' && (
            <>
              <div role="status" aria-live="polite">
                <p className={styles.statusLine}>
                  {t('subscription.pastDueTitle')}
                </p>
                <p className={sharedStyles.smallDescription}>
                  {formatPlan(view.subscription)
                    ? t('subscription.pastDueBody', {
                        plan: formatPlan(view.subscription),
                      })
                    : t('subscription.pastDueBodyNoPlan')}
                </p>
              </div>
              {!confirming && (
                <div className={styles.actions}>
                  <a
                    className={styles.primaryButton}
                    href={STRIPE_CUSTOMER_PORTAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleManageBillingPastDue}
                  >
                    {t('subscription.updatePayment')}
                  </a>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    ref={cancelButtonRef}
                    onClick={() => setConfirming(true)}
                    disabled={isCancellingPerSub}
                  >
                    {t('subscription.cancelSubscription')}
                  </button>
                </div>
              )}
              {confirming && (
                <CancelFlow
                  planLabel={formatPlan(view.subscription)}
                  tenureDays={tenureDaysOf(view.subscription)}
                  pauseEligible={false}
                  isCancelling={isCancellingPerSub}
                  isPausing={false}
                  pauseError=""
                  onCancel={handlePastDueCancel}
                  onKeep={handleKeep}
                  onPause={() => undefined}
                />
              )}
              {perSubCancelError && (
                <p className={styles.helpDanger}>
                  {t('subscription.cancelFailed')}
                </p>
              )}
            </>
          )}

          {view.kind === 'scheduled' && (
            <>
              <p className={styles.statusLine}>
                {t('subscription.endsPrefix')}{' '}
                <strong>{fmt(view.subscription.cancel_at)}</strong>.{' '}
                {t('subscription.accessContinues')}
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => cancelUserSubscription('immediate')}
                  disabled={isCancelling}
                >
                  {isCancelling
                    ? t('subscription.processing')
                    : t('subscription.cancelNowInstead')}
                </button>
              </div>
            </>
          )}

          {view.kind === 'cancelled' && (
            <div role="status" aria-live="polite">
              <p className={styles.statusLineMuted}>
                {t('subscription.endedPrefix')}{' '}
                <strong>{fmt(view.subscription.canceled_at)}</strong>.
                {formatPlan(view.subscription) &&
                  ` ${t('subscription.previousPlan', { plan: formatPlan(view.subscription) })}`}
              </p>
              {view.subscription.cancellation_reason === 'payment_failed' && (
                <p className={sharedStyles.smallDescription}>
                  {t('subscription.endedPaymentFailed')}
                </p>
              )}
            </div>
          )}

          {stripeStatus.isLoading && view.kind === 'none' && (
            <p
              role="status"
              aria-live="polite"
              className={sharedStyles.smallDescription}
            >
              {t('subscription.readingSubscription')}
            </p>
          )}

          {!stripeStatus.isLoading &&
            stripeStatus.isError &&
            view.kind === 'none' && (
              <p role="alert" className={sharedStyles.smallDescription}>
                {t('subscription.statusLoadFailed')}
              </p>
            )}

          {!stripeStatus.isLoading &&
            !stripeStatus.isError &&
            view.kind === 'none' && (
              <div>
                <h4 className={sharedStyles.smallHeading}>
                  {t('claimSubscription.mismatchTitle')}
                </h4>
                <p className={sharedStyles.smallDescription}>
                  {t('claimSubscription.mismatchBody')}
                </p>
                <ClaimSubscription variant="mismatch" />
              </div>
            )}

          {cancelError && <p className={styles.helpDanger}>{cancelError}</p>}
          {cancelSuccess && (
            <p className={styles.helpSuccess}>{cancelSuccess}</p>
          )}
        </div>
      )}
    </section>
  );
}

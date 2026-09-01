import { ReactElement } from 'react';
import sharedStyles from '../../styles/shared.module.css';
import accountStyles from '../AccountPage/AccountPage.module.css';
import {
  UserProfile,
  PlanDetails,
  AccountDeletion,
} from '../AccountPage/components';
import { CancelFlow } from '../AccountPage/components/CancelFlow';
import previewStyles from './AccountPreviewPage.module.css';

const noop = () => undefined;

interface Variant {
  label: string;
  note: string;
  render: () => ReactElement;
}

const variants: Variant[] = [
  {
    label: 'Free — regular email',
    note: 'New signup via email or Google.',
    render: () => (
      <>
        <UserProfile
          user={{ name: 'Alex Newcomer', email: 'alex@example.com' }}
        />
        <PlanDetails subscriptionType="free" />
        <AccountDeletion />
      </>
    ),
  },
  {
    label: 'Free — Apple Hide My Email',
    note: 'Signed up with Sign in with Apple and chose Hide My Email.',
    render: () => (
      <>
        <UserProfile
          user={{
            name: 'Alexander Alemayhu',
            email: 'j6y7w6md9k@privaterelay.appleid.com',
          }}
        />
        <PlanDetails subscriptionType="free" />
        <AccountDeletion />
      </>
    ),
  },
  {
    label: 'Premium subscriber — active',
    note: 'Active monthly subscription.',
    render: () => (
      <>
        <UserProfile user={{ name: 'Casey Pro', email: 'casey@example.com' }} />
        <PlanDetails subscriptionType="subscriber" />
        <section className={accountStyles.section}>
          <p className={accountStyles.statusLine}>
            $6.00 / month · Renews <strong>15 June 2026</strong>
          </p>
          <div className={accountStyles.actions}>
            <button type="button" className={accountStyles.secondaryButton}>
              Cancel at period end
            </button>
            <button type="button" className={accountStyles.textButton}>
              or cancel now
            </button>
          </div>
        </section>
        <AccountDeletion />
      </>
    ),
  },
  {
    label: 'Premium subscriber — legacy $2/mo',
    note: 'Active on the legacy price; about to be told what they’d lose.',
    render: () => (
      <>
        <UserProfile
          user={{ name: 'Dani Legacy', email: 'dani@example.com' }}
        />
        <PlanDetails subscriptionType="subscriber" />
        <section className={accountStyles.section}>
          <p className={accountStyles.statusLine}>
            $2.00 / month · Renews <strong>15 June 2026</strong>
          </p>
          <p className={accountStyles.legacyNote}>
            Cancelling forfeits this legacy rate.
          </p>
          <div className={accountStyles.actions}>
            <button type="button" className={accountStyles.secondaryButton}>
              Cancel at period end
            </button>
            <button type="button" className={accountStyles.textButton}>
              or cancel now
            </button>
          </div>
        </section>
        <AccountDeletion />
      </>
    ),
  },
  {
    label: 'Cancel flow — pause leads (legacy monthly)',
    note: 'Pause-eligible legacy sub mid-cancel: pause card leads, legacy line names the kept rate, cancel stays a visible peer.',
    render: () => (
      <>
        <UserProfile
          user={{ name: 'Dani Legacy', email: 'dani@example.com' }}
        />
        <PlanDetails subscriptionType="subscriber" />
        <section className={accountStyles.section}>
          <p className={accountStyles.statusLine}>
            $2.00 / month · Renews <strong>15 June 2026</strong>
          </p>
          <CancelFlow
            planLabel="$2.00 / month"
            tenureDays={120}
            pauseEligible
            isLegacyRate
            isCancelling={false}
            isPausing={false}
            pauseError=""
            onCancel={noop}
            onKeep={noop}
            onPause={noop}
          />
        </section>
        <AccountDeletion />
      </>
    ),
  },
  {
    label: 'Cancel flow — pause leads (standard monthly)',
    note: 'Pause-eligible standard sub mid-cancel: pause card leads, no legacy line, cancel stays a visible peer.',
    render: () => (
      <>
        <UserProfile user={{ name: 'Casey Pro', email: 'casey@example.com' }} />
        <PlanDetails subscriptionType="subscriber" />
        <section className={accountStyles.section}>
          <p className={accountStyles.statusLine}>
            $7.99 / month · Renews <strong>15 June 2026</strong>
          </p>
          <CancelFlow
            planLabel="$7.99 / month"
            tenureDays={90}
            pauseEligible
            isLegacyRate={false}
            isCancelling={false}
            isPausing={false}
            pauseError=""
            onCancel={noop}
            onKeep={noop}
            onPause={noop}
          />
        </section>
        <AccountDeletion />
      </>
    ),
  },
  {
    label: 'Premium subscriber — scheduled to cancel',
    note: 'Has cancelled; still inside the paid window.',
    render: () => (
      <>
        <UserProfile
          user={{ name: 'Jamie Leaving', email: 'jamie@example.com' }}
        />
        <PlanDetails subscriptionType="subscriber" />
        <section className={accountStyles.section}>
          <p className={accountStyles.statusLine}>
            Ends <strong>15 June 2026</strong>. Access continues until then.
          </p>
          <div className={accountStyles.actions}>
            <button type="button" className={accountStyles.textButton}>
              Cancel now instead
            </button>
          </div>
        </section>
        <AccountDeletion />
      </>
    ),
  },
  {
    label: 'Cancelled subscriber',
    note: 'Sub already ended; sees what was lost.',
    render: () => (
      <>
        <UserProfile user={{ name: 'Sam Past', email: 'sam@example.com' }} />
        <PlanDetails subscriptionType="free" />
        <section className={accountStyles.section}>
          <p className={accountStyles.statusLineMuted}>
            Ended <strong>1 May 2026</strong>. Previous plan: $6.00 / month.
          </p>
        </section>
        <AccountDeletion />
      </>
    ),
  },
  {
    label: 'Lifetime',
    note: 'Bought the lifetime plan; nothing to manage.',
    render: () => (
      <>
        <UserProfile
          user={{ name: 'Robin Forever', email: 'robin@example.com' }}
        />
        <PlanDetails subscriptionType="lifetime" />
        <AccountDeletion />
      </>
    ),
  },
];

export default function AccountPreviewPage() {
  return (
    <div className={previewStyles.outer}>
      <header className={previewStyles.outerHeader}>
        <h1 className={sharedStyles.title}>Account — variants</h1>
        <p className={sharedStyles.subtitle}>
          Visual preview only. Not linked from navigation. Not gated by auth.
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
              <div className={accountStyles.page}>{variant.render()}</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

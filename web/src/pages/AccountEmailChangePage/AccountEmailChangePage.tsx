import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { post } from '../../lib/backend/api';
import { track } from '../../lib/analytics/track';
import { SkeletonPage } from '../../components/Skeleton/Skeleton';
import sharedStyles from '../../styles/shared.module.css';

type State = 'loading' | 'success' | 'invalid' | 'taken';

export default function AccountEmailChangePage() {
  const { t } = useTranslation('accountx');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }

    post('/api/users/email-change/confirm', { token })
      .then(async (res) => {
        if (res.ok) {
          track('email_change_confirmed');
          setState('success');
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          reason?: string;
        };
        setState(body.reason === 'email_taken' ? 'taken' : 'invalid');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  if (state === 'loading') return <SkeletonPage rows={2} />;

  const copy = {
    success: {
      title: t('emailChangeConfirm.successTitle'),
      body: t('emailChangeConfirm.successBody'),
    },
    taken: {
      title: t('emailChangeConfirm.takenTitle'),
      body: t('emailChangeConfirm.takenBody'),
    },
    invalid: {
      title: t('emailChangeConfirm.invalidTitle'),
      body: t('emailChangeConfirm.invalidBody'),
    },
  }[state];

  return (
    <div className={sharedStyles.pageNarrow}>
      <div className={sharedStyles.card}>
        <h1 className={sharedStyles.title}>{copy.title}</h1>
        <p>{copy.body}</p>
        <a href="/account?email_changed=1" className={sharedStyles.btnPrimary}>
          {t('claim.goToAccount')}
        </a>
      </div>
    </div>
  );
}

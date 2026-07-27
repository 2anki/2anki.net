import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { post } from '../../lib/backend/api';
import { SkeletonPage } from '../../components/Skeleton/Skeleton';
import sharedStyles from '../../styles/shared.module.css';

type State =
  | 'loading'
  | 'success'
  | 'expired'
  | 'already_claimed'
  | 'active_sub'
  | 'unauthenticated'
  | 'error'
  | 'pass_success'
  | 'pass_already_claimed'
  | 'pass_expired';

interface PassResult {
  passKind: string;
  expiresAt: string;
}

export default function AccountClaimPage() {
  const { t, i18n } = useTranslation('accountx');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const isPassClaim = searchParams.get('kind') === 'pass';
  const [state, setState] = useState<State>('loading');
  const [passResult, setPassResult] = useState<PassResult | null>(null);

  useEffect(() => {
    if (!token) {
      setState('expired');
      return;
    }

    const redirectToLogin = () => {
      const kindParam = isPassClaim ? '&kind=pass' : '';
      const next = encodeURIComponent(
        `/account/claim?token=${encodeURIComponent(token)}${kindParam}`
      );
      globalThis.location.href = `/login?next=${next}`;
    };

    if (isPassClaim) {
      post('/api/passes/claim/confirm', { token })
        .then(async (res) => {
          if (res.status === 401) {
            redirectToLogin();
            return;
          }
          const body = (await res.json().catch(() => ({}))) as {
            passKind?: string;
            expiresAt?: string;
            reason?: string;
          };
          if (res.ok && body.passKind != null && body.expiresAt != null) {
            setPassResult({
              passKind: body.passKind,
              expiresAt: body.expiresAt,
            });
            setState('pass_success');
            return;
          }
          if (body.reason === 'already_claimed') {
            setState('pass_already_claimed');
          } else if (body.reason === 'pass_expired') {
            setState('pass_expired');
          } else {
            setState('expired');
          }
        })
        .catch(() => setState('error'));
      return;
    }

    post('/api/subscriptions/claim/confirm', { token })
      .then(async (res) => {
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (res.ok) {
          setState('success');
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        const msg = body.message ?? '';
        if (msg.includes('already used')) {
          setState('already_claimed');
        } else if (msg.includes('active subscription')) {
          setState('active_sub');
        } else {
          setState('expired');
        }
      })
      .catch(() => setState('error'));
  }, [token, isPassClaim]);

  if (state === 'loading') return <SkeletonPage rows={2} />;

  // VOICE date shape for English is "3 August 2026" (day first), which is
  // en-GB ordering; other locales keep their native order.
  const formatExpiry = (iso: string) =>
    new Date(iso).toLocaleDateString(
      i18n.language.startsWith('en') ? 'en-GB' : i18n.language,
      { day: 'numeric', month: 'long', year: 'numeric' }
    );

  return (
    <div className={sharedStyles.pageNarrow}>
      <div className={sharedStyles.card}>
        {state === 'success' && (
          <>
            <h1 className={sharedStyles.title}>{t('claim.successTitle')}</h1>
            <p>{t('claim.successBody')}</p>
            <a href="/account" className={sharedStyles.btnPrimary}>
              {t('claim.goToAccount')}
            </a>
          </>
        )}
        {state === 'pass_success' && passResult && (
          <>
            <h1 className={sharedStyles.title}>
              {t('claim.passSuccessTitle')}
            </h1>
            <p>
              {t('claim.passSuccessBody', {
                passKind: passResult.passKind,
                expiry: formatExpiry(passResult.expiresAt),
              })}
            </p>
            <a href="/account" className={sharedStyles.btnPrimary}>
              {t('claim.goToAccount')}
            </a>
          </>
        )}
        {state === 'pass_already_claimed' && (
          <>
            <h1 className={sharedStyles.title}>
              {t('claim.passAlreadyClaimedTitle')}
            </h1>
            <p>{t('claim.passAlreadyClaimedBody')}</p>
            <a href="/account" className={sharedStyles.btnPrimary}>
              {t('claim.goToAccount')}
            </a>
          </>
        )}
        {state === 'pass_expired' && (
          <>
            <h1 className={sharedStyles.title}>
              {t('claim.passExpiredTitle')}
            </h1>
            <p>{t('claim.passExpiredBody')}</p>
            <a href="/account" className={sharedStyles.btnPrimary}>
              {t('claim.goToAccount')}
            </a>
          </>
        )}
        {(state === 'expired' || state === 'error') && (
          <>
            <h1 className={sharedStyles.title}>{t('claim.expiredTitle')}</h1>
            <p>{t('claim.expiredBody')}</p>
            <a href="/account" className={sharedStyles.btnPrimary}>
              {t('claim.goToAccount')}
            </a>
          </>
        )}
        {state === 'already_claimed' && (
          <>
            <h1 className={sharedStyles.title}>
              {t('claim.alreadyUsedTitle')}
            </h1>
            <p>{t('claim.alreadyUsedBody')}</p>
            <a href="/account" className={sharedStyles.btnPrimary}>
              {t('claim.goToAccount')}
            </a>
          </>
        )}
        {state === 'active_sub' && (
          <>
            <h1 className={sharedStyles.title}>{t('claim.activeSubTitle')}</h1>
            <p>{t('claim.activeSubBody')}</p>
            <a href="/account" className={sharedStyles.btnPrimary}>
              {t('claim.goToAccount')}
            </a>
          </>
        )}
      </div>
    </div>
  );
}

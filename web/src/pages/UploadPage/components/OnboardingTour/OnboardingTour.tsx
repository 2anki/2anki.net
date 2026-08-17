import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../../lib/analytics/track';
import { markOnboarded } from '../../../../lib/backend/markOnboarded';
import { useDialogFocus } from '../../../../lib/hooks/useDialogFocus';
import styles from './OnboardingTour.module.css';

const STEP_KEYS: ReadonlyArray<{ title: string; hint: string }> = [
  {
    title: 'upload.onboarding.step1Title',
    hint: 'upload.onboarding.step1Hint',
  },
  {
    title: 'upload.onboarding.step2Title',
    hint: 'upload.onboarding.step2Hint',
  },
  {
    title: 'upload.onboarding.step3Title',
    hint: 'upload.onboarding.step3Hint',
  },
  {
    title: 'upload.onboarding.step4Title',
    hint: 'upload.onboarding.step4Hint',
  },
];

const MIGRATION_CUTOFF = '2026-05-19T00:00:00.000Z';

interface OnboardingTourProps {
  createdAt: string | null;
  onboardedAt: string | null;
  migrationDate?: string;
}

function shouldShowTour(
  createdAt: string | null,
  onboardedAt: string | null,
  migrationDate: string
): boolean {
  if (createdAt == null) return false;
  if (onboardedAt != null) return false;
  return new Date(createdAt).getTime() >= new Date(migrationDate).getTime();
}

export function OnboardingTour({
  createdAt,
  onboardedAt,
  migrationDate = MIGRATION_CUTOFF,
}: Readonly<OnboardingTourProps>) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const shownTracked = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const visible =
    !dismissed && shouldShowTour(createdAt, onboardedAt, migrationDate);
  const isLast = step === STEP_KEYS.length - 1;

  useEffect(() => {
    if (visible && !shownTracked.current) {
      shownTracked.current = true;
      track('onboarding_shown');
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    track(isLast ? 'onboarding_completed' : 'onboarding_skipped');
    setDismissed(true);
    void markOnboarded();
  }, [isLast]);

  useDialogFocus(dialogRef, handleClose, visible);

  if (!visible) return null;

  const current = STEP_KEYS[step];
  const isFirst = step === 0;

  return (
    <div
      ref={dialogRef}
      className={styles.tour}
      role="dialog"
      aria-label={t('upload.onboarding.aria')}
      aria-modal="true"
    >
      <div className={styles.progress}>
        {STEP_KEYS.map((s, i) => (
          <span
            key={s.title}
            className={i === step ? styles.dotActive : styles.dot}
            aria-hidden="true"
          />
        ))}
      </div>
      <p className={styles.title}>{t(current.title)}</p>
      <p className={styles.hint}>{t(current.hint)}</p>
      <div className={styles.controls}>
        {!isFirst && (
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setStep((s) => s - 1)}
          >
            {t('upload.onboarding.back')}
          </button>
        )}
        {!isLast && (
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setStep((s) => s + 1)}
          >
            {t('upload.onboarding.next')}
          </button>
        )}
        <button type="button" className={styles.btnSkip} onClick={handleClose}>
          {t('upload.onboarding.skip')}
        </button>
      </div>
    </div>
  );
}

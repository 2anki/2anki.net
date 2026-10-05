import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import styles from './DeckDistributionPanel.module.css';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ANSWERS = [
  { value: 'students', labelKey: 'options.students' },
  { value: 'customers', labelKey: 'options.customers' },
  { value: 'study_group', labelKey: 'options.studyGroup' },
  { value: 'colleagues', labelKey: 'options.colleagues' },
  { value: 'just_me', labelKey: 'options.justMe' },
] as const;

type Answer = (typeof ANSWERS)[number]['value'];

type Stage =
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error' };

interface DeckDistributionPanelProps {
  uploadKey: string;
  defaultEmail?: string | null;
}

function submitLabel(stage: Stage, t: TFunction): string {
  if (stage.kind === 'sending') return t('sending');
  if (stage.kind === 'error') return t('tryAgain');
  return t('submit');
}

export function DeckDistributionPanel({
  uploadKey,
  defaultEmail,
}: Readonly<DeckDistributionPanelProps>) {
  const { t } = useTranslation('deckdistribution');
  const groupId = useId();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [emailError, setEmailError] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'form' });

  const submit = async () => {
    if (answer == null) return;
    const trimmedEmail = email.trim();
    if (trimmedEmail.length > 0 && !EMAIL_SHAPE.test(trimmedEmail)) {
      setEmailError(true);
      return;
    }
    setEmailError(false);
    setStage({ kind: 'sending' });
    try {
      await get2ankiApi().recordDeckDistributionIntent(
        answer,
        uploadKey,
        trimmedEmail.length > 0 ? trimmedEmail : undefined
      );
      setStage({ kind: 'sent' });
    } catch {
      setStage({ kind: 'error' });
    }
  };

  if (stage.kind === 'sent') {
    return (
      <aside className={styles.panel} aria-label={t('ariaLabel')}>
        <p className={styles.title}>{t('sentTitle')}</p>
        <p className={styles.body}>{t('sentBody')}</p>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-label={t('ariaLabel')}>
      <p className={styles.title}>{t('title')}</p>
      <p className={styles.body}>{t('body')}</p>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t('question')}</legend>
        {ANSWERS.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              type="radio"
              name={groupId}
              value={option.value}
              checked={answer === option.value}
              onChange={() => setAnswer(option.value)}
            />
            <span>{t(option.labelKey)}</span>
          </label>
        ))}
      </fieldset>

      <label className={styles.notifyLabel} htmlFor={`${groupId}-email`}>
        {t('notifyLabel')}
      </label>
      <input
        id={`${groupId}-email`}
        type="email"
        className={styles.input}
        data-hj-suppress
        placeholder={t('emailPlaceholder')}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (emailError) setEmailError(false);
        }}
      />
      {emailError && <p className={styles.error}>{t('emailInvalid')}</p>}

      {stage.kind === 'error' && <p className={styles.error}>{t('error')}</p>}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={submit}
          disabled={answer == null || stage.kind === 'sending'}
        >
          {submitLabel(stage, t)}
        </button>
      </div>
    </aside>
  );
}

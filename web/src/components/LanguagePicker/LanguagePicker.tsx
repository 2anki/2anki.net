import { type ChangeEvent, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../lib/analytics/track';
import {
  LANGUAGE_ENDONYMS,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '../../lib/i18n';
import { scheduleSync } from '../../lib/data_layer/userPreferencesSync';
import styles from './LanguagePicker.module.css';

interface LanguagePickerProps {
  readonly variant?: 'compact' | 'labeled' | 'bare';
}

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function LanguagePicker({ variant = 'compact' }: LanguagePickerProps) {
  const { t, i18n } = useTranslation();
  const selectId = useId();
  const resolved = i18n.resolvedLanguage ?? i18n.language;
  const current = isSupportedLanguage(resolved) ? resolved : 'en';

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isSupportedLanguage(next)) {
      return;
    }
    i18n.changeLanguage(next);
    scheduleSync();
    track('language_changed', { language: next });
  }

  const options: { value: SupportedLanguage; label: string }[] =
    SUPPORTED_LANGUAGES.map((value) => ({
      value,
      label: LANGUAGE_ENDONYMS[value],
    }));

  if (variant === 'labeled') {
    return (
      <div className={styles.labeledRow}>
        <label htmlFor={selectId} className={styles.rowLabel}>
          {t('language.label')}
        </label>
        <p className={styles.rowDescription}>{t('language.description')}</p>
        <div className={styles.selectWrap}>
          <span className={styles.globe} aria-hidden="true">
            🌐
          </span>
          <select
            id={selectId}
            className={styles.select}
            value={current}
            onChange={handleChange}
          >
            {options.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (variant === 'bare') {
    return (
      <div className={styles.bare}>
        <span className={styles.globe} aria-hidden="true">
          🌐
        </span>
        <span className={styles.bareCode} aria-hidden="true">
          {current.toUpperCase()}
        </span>
        <span className={styles.bareChevron} aria-hidden="true">
          ▾
        </span>
        <select
          className={styles.bareSelect}
          value={current}
          onChange={handleChange}
          aria-label={t('language.picker')}
        >
          {options.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className={`${styles.selectWrap} ${styles.compact}`}>
      <span className={styles.globe} aria-hidden="true">
        🌐
      </span>
      <select
        className={styles.select}
        value={current}
        onChange={handleChange}
        aria-label={t('language.picker')}
      >
        {options.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

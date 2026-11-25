import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../../lib/analytics/track';
import { estimateGiftCredits } from '../../../../lib/aiGift/estimateGiftCredits';
import { uploadInputFormat } from './uploadInputFormat';
import { HeldFileRows } from './HeldFileRows';
import sharedStyles from '../../../../styles/shared.module.css';
import styles from './AiGiftUploadCard.module.css';

interface Props {
  files: readonly File[];
  creditsLeft: number;
  switchOnByDefault: boolean;
  onConvert: (claude: boolean, changed: boolean) => void;
  onRemove: () => void;
  estimate?: (files: readonly File[]) => Promise<number | null>;
}

interface Reading {
  estimate: number | null;
  defaultOn: boolean;
}

// The step between choosing a file and converting it, for an account whose
// next upload the server says can use gift credits: one switch, the cost
// before anything runs when there is an honest number, the line that Claude
// stops when the credits run out, and one primary action.
export function GiftConvertStep({
  files,
  creditsLeft,
  switchOnByDefault,
  onConvert,
  onRemove,
  estimate = estimateGiftCredits,
}: Readonly<Props>) {
  const { t } = useTranslation('aiGift');
  const [reading, setReading] = useState<Reading | null>(null);
  const [claude, setClaude] = useState(false);

  useEffect(() => {
    let live = true;
    void estimate(files).then((credits) => {
      if (!live) return;
      const fits = credits == null || credits <= creditsLeft;
      const defaultOn = switchOnByDefault && fits;
      setReading({ estimate: credits, defaultOn });
      setClaude(defaultOn);
      track('ai_toggle_shown', {
        surface: 'upload_card',
        on: defaultOn,
        estimate: credits,
        fits,
        format: uploadInputFormat(files),
      });
    });
    return () => {
      live = false;
    };
  }, [files, creditsLeft, switchOnByDefault, estimate]);

  if (reading == null) {
    return (
      <div className={styles.step}>
        <HeldFileRows files={files} onRemove={onRemove} />
      </div>
    );
  }

  const costLine = (() => {
    if (reading.estimate == null) {
      return t('convert.left', { count: creditsLeft });
    }
    return reading.estimate <= creditsLeft
      ? t('convert.estimate', { count: reading.estimate, left: creditsLeft })
      : t('convert.over', { count: reading.estimate, left: creditsLeft });
  })();

  return (
    <div className={styles.step}>
      <HeldFileRows files={files} onRemove={onRemove} />
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          role="switch"
          className={styles.toggle}
          checked={claude}
          onChange={(event) => setClaude(event.target.checked)}
        />
        <span>{t('convert.toggle')}</span>
      </label>
      <p className={styles.estimate}>
        {costLine} {t('convert.stops')}
      </p>
      <button
        type="button"
        className={`${sharedStyles.btnPrimary} ${styles.chooseButton}`}
        onClick={() => {
          if (claude) {
            track('ai_toggle_on', {
              surface: 'upload_card',
              changed: claude !== reading.defaultOn,
            });
          }
          onConvert(claude, claude !== reading.defaultOn);
        }}
      >
        {t('convert.convert')}
      </button>
    </div>
  );
}

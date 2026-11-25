import { useEffect, useRef, useState } from 'react';
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
  claudeByDefault: boolean;
  onConvert: (claude: boolean, changed: boolean) => void;
  onRemove: () => void;
}

// The step between choosing a file and converting it, for an account the
// server says has gift credits: one switch, the cost before anything runs,
// one primary action.
export function GiftConvertStep({
  files,
  creditsLeft,
  claudeByDefault,
  onConvert,
  onRemove,
}: Readonly<Props>) {
  const { t } = useTranslation('aiGift');
  const estimate = estimateGiftCredits(files);
  const fits = estimate <= creditsLeft;
  const defaultOn = claudeByDefault && fits;
  const [claude, setClaude] = useState(defaultOn);
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    track('ai_gift_toggle_shown', {
      surface: 'upload_card',
      on: defaultOn,
      estimate,
      fits,
      format: uploadInputFormat(files),
    });
  }, [defaultOn, estimate, fits, files]);

  const estimateLine = fits
    ? t('convert.estimate', { count: estimate, left: creditsLeft })
    : t('convert.over', { count: estimate, left: creditsLeft });

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
      <p className={styles.estimate}>{estimateLine}</p>
      <button
        type="button"
        className={`${sharedStyles.btnPrimary} ${styles.chooseButton}`}
        onClick={() => onConvert(claude, claude !== defaultOn)}
      >
        {t('convert.convert')}
      </button>
    </div>
  );
}

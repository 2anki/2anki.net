import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { track } from '../../../../lib/analytics/track';
import formStyles from './UploadForm.module.css';

interface FoldedTogglesNoticeProps {
  count: number;
  // Absent when the file cannot be sent again from here (Dropbox, Drive).
  onPromote?: () => void;
  actionLabel?: string;
  disabled?: boolean;
  busy?: boolean;
}

export function FoldedTogglesNotice({
  count,
  onPromote,
  actionLabel,
  disabled = false,
  busy = false,
}: Readonly<FoldedTogglesNoticeProps>) {
  const { t } = useTranslation();
  const canPromote = onPromote != null;
  const option = t('cardoptions:options.promote-nested-toggles.label');

  useEffect(() => {
    track('folded_toggles_notice_shown', { count, can_promote: canPromote });
  }, [count, canPromote]);

  return (
    <div className={formStyles.aiRescueActions}>
      <p className={formStyles.rescueLead}>
        {t('upload.foldedToggles.count', { count })}
      </p>
      {onPromote == null ? (
        <Link
          to="/card-options?returnTo=/upload"
          className={formStyles.aiRescueButton}
        >
          {t('upload.foldedToggles.link', { option })}
        </Link>
      ) : (
        <>
          <button
            type="button"
            className={formStyles.aiRescueButton}
            onClick={onPromote}
            disabled={disabled}
            aria-busy={busy}
          >
            {actionLabel ?? t('upload.foldedToggles.action')}
          </button>
          <p className={formStyles.successSecondary}>
            {t('upload.foldedToggles.note', { option })}
          </p>
        </>
      )}
    </div>
  );
}

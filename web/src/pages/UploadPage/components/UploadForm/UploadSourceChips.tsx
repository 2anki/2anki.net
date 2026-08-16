import { useTranslation } from 'react-i18next';
import styles from './UploadSourceChips.module.css';

export type UploadSource = 'local' | 'dropbox' | 'google_drive';

interface Props {
  active: UploadSource;
  onChange: (next: UploadSource) => void;
  dropboxAvailable: boolean;
  googleDriveAvailable: boolean;
}

function DropboxIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={styles.dropboxIcon}
    >
      <path
        fill="#0061FF"
        d="M8 4l8 5-8 5-8-5 8-5zm16 0l8 5-8 5-8-5 8-5zM0 19l8-5 8 5-8 5-8-5zm24-5l8 5-8 5-8-5 8-5zM8 26l8-5 8 5-8 5-8-5z"
      />
    </svg>
  );
}

function GoogleDriveIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 87.3 78"
      aria-hidden="true"
      className={styles.driveIcon}
    >
      <path
        fill="#0066DA"
        d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z"
      />
      <path
        fill="#00AC47"
        d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5l16.15-28z"
      />
      <path
        fill="#EA4335"
        d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5L73.55 76.8z"
      />
      <path
        fill="#00832D"
        d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0h-18.5c-1.6 0-3.15.45-4.5 1.2l13.75 23.8z"
      />
      <path
        fill="#2684FC"
        d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2L59.8 53z"
      />
      <path
        fill="#FFBA00"
        d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5l-12.65-22z"
      />
    </svg>
  );
}

export function UploadSourceChips({
  active,
  onChange,
  dropboxAvailable,
  googleDriveAvailable,
}: Readonly<Props>) {
  const { t } = useTranslation();
  return (
    <div className={styles.wrapper}>
      <div className={styles.divider} aria-hidden="true">
        <span className={styles.dividerText}>{t('upload.dropzone.or')}</span>
      </div>
      <div
        className={styles.chips}
        role="group"
        aria-label={t('upload.chips.groupAria')}
      >
        <button
          type="button"
          aria-pressed={active === 'dropbox'}
          disabled={!dropboxAvailable}
          className={`${styles.chip} ${active === 'dropbox' ? styles.chipActive : ''}`}
          onClick={() => onChange(active === 'dropbox' ? 'local' : 'dropbox')}
        >
          <DropboxIcon />
          <span>Dropbox</span>
        </button>
        <button
          type="button"
          aria-pressed={active === 'google_drive'}
          disabled={!googleDriveAvailable}
          className={`${styles.chip} ${active === 'google_drive' ? styles.chipActive : ''}`}
          onClick={() =>
            onChange(active === 'google_drive' ? 'local' : 'google_drive')
          }
        >
          <GoogleDriveIcon />
          <span>Google Drive</span>
        </button>
      </div>
    </div>
  );
}

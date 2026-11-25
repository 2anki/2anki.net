import { useTranslation } from 'react-i18next';
import styles from './AiGiftUploadCard.module.css';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  files: readonly File[];
  onRemove: () => void;
}

export function HeldFileRows({ files, onRemove }: Readonly<Props>) {
  const { t } = useTranslation('aiGift');
  return (
    <ul className={styles.fileRows}>
      {files.map((file, index) => (
        <li key={`${file.name}-${index}`} className={styles.fileRow}>
          <span className={styles.fileName} data-hj-suppress>
            {file.name}
          </span>
          <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
          {index === 0 && (
            <button
              type="button"
              className={styles.textButton}
              onClick={onRemove}
            >
              {t('card.removeFile')}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

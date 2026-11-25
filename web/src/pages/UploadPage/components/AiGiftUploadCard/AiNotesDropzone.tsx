import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import ArrowUpTrayIcon from '../../../../components/icons/ArrowUpTrayIcon';
import {
  GIFT_ACCEPT,
  acceptedByGift,
} from '../../../../lib/aiGift/giftFileKinds';
import sharedStyles from '../../../../styles/shared.module.css';
import styles from './AiGiftUploadCard.module.css';

interface Props {
  onFiles: (files: File[]) => void;
}

// The AI mode's own drop target. It stops the drop here, so the page-wide
// drop of the upload form underneath never sees it.
export function AiNotesDropzone({ onFiles }: Readonly<Props>) {
  const { t } = useTranslation('aiGift');
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState(false);

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (!acceptedByGift(files)) {
      setRejected(true);
      return;
    }
    setRejected(false);
    onFiles(files);
  };

  const hold = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(true);
  };

  return (
    <div
      className={
        over ? `${styles.dropzone} ${styles.dropzoneOver}` : styles.dropzone
      }
      data-testid="ai-notes-dropzone"
      onDragEnter={hold}
      onDragOver={hold}
      onDragLeave={(event) => {
        event.stopPropagation();
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        take(event.dataTransfer?.files ?? null);
      }}
    >
      <span className={styles.dropIcon} aria-hidden="true">
        <ArrowUpTrayIcon width={24} height={24} />
      </span>
      <p className={styles.dropTitle}>{t('card.dropTitle')}</p>
      <p className={styles.dropBody}>{t('card.dropBody')}</p>
      <button
        type="button"
        className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline} ${styles.chooseButton}`}
        onClick={() => inputRef.current?.click()}
      >
        {t('card.chooseFile')}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={GIFT_ACCEPT}
        className={sharedStyles.hidden}
        aria-label={t('card.chooseFile')}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
      {rejected && (
        <p className={styles.rejected} role="alert">
          {t('card.rejected')}
        </p>
      )}
    </div>
  );
}

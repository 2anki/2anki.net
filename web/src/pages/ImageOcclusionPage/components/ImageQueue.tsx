import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageEntry } from '../types';
import { FREE_TIER_LIMIT } from '../freeTier';
import styles from '../ImageOcclusionPage.module.css';
import { Link } from 'react-router-dom';

interface Props {
  entries: ImageEntry[];
  activeIndex: number;
  onSelect: (i: number) => void;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onHeaderChange: (i: number, header: string) => void;
  isPaying: boolean;
  isNotionConnected: boolean;
  onImportFromNotion: () => void;
  keptFirst?: number | null;
}

export function ImageQueue({
  entries,
  activeIndex,
  onSelect,
  onAdd,
  onRemove,
  onHeaderChange,
  isPaying,
  isNotionConnected,
  onImportFromNotion,
  keptFirst = null,
}: Readonly<Props>) {
  const { t } = useTranslation('tools');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const atLimit = !isPaying && entries.length >= FREE_TIER_LIMIT;
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onAdd(files);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!atLimit) setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (atLimit) return;
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length > 0) onAdd(files);
  };

  return (
    <div
      className={`${styles.queue} ${isDragOver ? styles.queueDragOver : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.queueList}>
        {entries.map((entry, i) => (
          <div
            key={entry.id}
            className={`${styles.queueItem} ${i === activeIndex ? styles.queueItemActive : ''}`}
          >
            <button
              type="button"
              className={styles.queueThumbBtn}
              onClick={() => !entry.uploading && onSelect(i)}
              disabled={entry.uploading}
              aria-busy={entry.uploading || undefined}
              aria-label={
                entry.uploading
                  ? t('occlusion.importingImage', { name: entry.imageName })
                  : t('occlusion.selectImage', {
                      index: i + 1,
                      name: entry.imageName,
                    })
              }
            >
              {entry.uploading ? (
                <div className={styles.queueThumbSkeleton} />
              ) : (
                <img
                  src={entry.previewUrl}
                  alt={entry.imageName}
                  className={styles.queueThumb}
                />
              )}
              {entry.rects.length > 0 && !entry.uploading && (
                <span className={styles.queueBadge}>
                  {t('occlusion.boxes', { count: entry.rects.length })}
                </span>
              )}
            </button>
            <input
              type="text"
              value={entry.header}
              onChange={(e) => onHeaderChange(i, e.target.value)}
              placeholder={t('occlusion.headerPlaceholder')}
              className={styles.headerInput}
              aria-label={t('occlusion.headerAria', { index: i + 1 })}
            />
            <button
              type="button"
              className={styles.queueRemoveBtn}
              onClick={() => onRemove(entry.id)}
              aria-label={t('occlusion.removeImage', { index: i + 1 })}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className={styles.addBtn}
        onClick={() => !atLimit && fileInputRef.current?.click()}
        disabled={atLimit}
        title={atLimit ? t('occlusion.upgradeToAddMoreImages') : undefined}
        aria-disabled={atLimit}
      >
        {t('occlusion.uploadImages')}
      </button>
      {isNotionConnected && (
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => !atLimit && onImportFromNotion()}
          disabled={atLimit}
          title={
            atLimit
              ? t('occlusion.upgradeToAddMoreImages')
              : t('occlusion.pickPagePickImages')
          }
          aria-disabled={atLimit}
        >
          <img
            src="/icons/Notion_app_logo.png"
            alt=""
            width={14}
            height={14}
            style={{
              verticalAlign: 'middle',
              marginRight: '0.375rem',
              opacity: 0.8,
            }}
          />
          {t('occlusion.importFromNotion')}
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      {!isPaying && (
        <div className={styles.upgradeNotice}>
          {keptFirst != null && keptFirst > 0 ? (
            <>
              <p>{t('occlusion.keptFirstImages', { count: keptFirst })}</p>
              <Link to="/pricing" className={styles.upgradeLink}>
                {t('occlusion.upgradeToAddMore')}
              </Link>
            </>
          ) : atLimit ? (
            <>
              <p>{t('occlusion.freePlanAdded')}</p>
              <Link to="/pricing" className={styles.upgradeLink}>
                {t('occlusion.upgradeToAddMore')}
              </Link>
            </>
          ) : (
            <>
              {t('occlusion.freePlanCount', { count: entries.length })}{' '}
              <Link to="/pricing" className={styles.upgradeLink}>
                {t('occlusion.upgradeForUnlimited')}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

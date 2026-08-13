import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { isPayingUser } from '../../components/NavigationBar/helpers/getPlanLabel';
import { track } from '../../lib/analytics/track';
import styles from '../../styles/shared.module.css';
import pageStyles from './PhotoToFlashcardsPage.module.css';
import {
  prepareImageForVision,
  type PreparedImage,
} from '../../lib/image/prepareImageForVision';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
];
const PICKER_ACCEPT = [...ALLOWED_TYPES, '.heic', '.heif'].join(',');
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

type Status = 'idle' | 'reading' | 'done';
type UploadSource = 'camera' | 'library';
type Density = 'sparse' | 'balanced' | 'dense';
type PhotoMode = 'generative' | 'verbatim';

interface SelectedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

const MIN_CARDS = 1;
const MAX_CARDS = 20;
const DEFAULT_CARDS = 10;

const CARD_COUNT_STORAGE_KEY = 'photoToFlashcards.cardCount';
const MCQ_ENABLED_STORAGE_KEY = 'photoToFlashcards.mcqEnabled';

function readStoredCardCount(): number {
  if (typeof window === 'undefined') return DEFAULT_CARDS;
  const stored = Number(window.localStorage.getItem(CARD_COUNT_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored < MIN_CARDS || stored > MAX_CARDS) {
    return DEFAULT_CARDS;
  }
  return Math.round(stored);
}

function readStoredMcqEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MCQ_ENABLED_STORAGE_KEY) === 'true';
}

function cardCountToDensity(count: number): Density {
  if (count <= 5) return 'sparse';
  if (count <= 10) return 'balanced';
  return 'dense';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function makePhotoId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
  return `photo-${Date.now()}-${hex}`;
}

function validatePhoto(file: File): string | null {
  if (file.size > MAX_SIZE_BYTES) {
    return 'photo.overLimit';
  }
  if (file.type !== '' && !ALLOWED_TYPES.includes(file.type)) {
    return 'photo.badFormat';
  }
  return null;
}

export function PhotoToFlashcardsPage() {
  const { t } = useTranslation('tools');
  const { data } = useUserLocals();
  const isPaying = isPayingUser(data?.locals);

  const [deckName, setDeckName] = useState('');
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [cardCount, setCardCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadSource, setUploadSource] = useState<UploadSource>('library');
  const [includeSourceImage, setIncludeSourceImage] = useState(true);
  const [targetCardCount, setTargetCardCount] =
    useState<number>(readStoredCardCount);
  const density: Density = cardCountToDensity(targetCardCount);
  const [mode, setMode] = useState<PhotoMode>('generative');
  const [includeMcq, setIncludeMcq] = useState<boolean>(readStoredMcqEnabled);
  const [verbatimEmptyState, setVerbatimEmptyState] = useState(false);
  const card1Ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const photoCount = photos.length;

  const resetInputs = () => {
    if (fileInputRef.current != null) fileInputRef.current.value = '';
    if (cameraInputRef.current != null) cameraInputRef.current.value = '';
  };

  const reset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setStatus('idle');
    setCardCount(0);
    setError(null);
    setVerbatimEmptyState(false);
    resetInputs();
  };

  const appendPhotos = (incoming: File[], source: UploadSource) => {
    if (incoming.length === 0) return;
    setError(null);

    const accepted: SelectedPhoto[] = [];
    let rejection: string | null = null;
    for (const file of incoming) {
      const issue = validatePhoto(file);
      if (issue != null) {
        rejection = issue;
        continue;
      }
      accepted.push({
        id: makePhotoId(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (accepted.length === 0) {
      if (rejection != null) setError(t(rejection));
      resetInputs();
      return;
    }

    if (rejection != null) setError(t(rejection));
    setUploadSource(source);
    setPhotos((current) => [...current, ...accepted]);
    setStatus('idle');
    setCardCount(0);
    setVerbatimEmptyState(false);
    resetInputs();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(e.target.files ?? []);
    appendPhotos(next, 'library');
  };

  const handleCameraInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(e.target.files ?? []);
    appendPhotos(next, 'camera');
  };

  const handleCardCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value);
    if (!Number.isFinite(raw)) return;
    const clamped = Math.min(MAX_CARDS, Math.max(MIN_CARDS, Math.round(raw)));
    setTargetCardCount(clamped);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CARD_COUNT_STORAGE_KEY, String(clamped));
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const next = Array.from(e.dataTransfer.files ?? []);
    appendPhotos(next, 'library');
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLLabelElement>) => {
    const items = Array.from(e.clipboardData?.files ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    appendPhotos(items, 'library');
  };

  const removePhoto = (id: string) => {
    setPhotos((current) => {
      const removed = current.find((p) => p.id === id);
      if (removed != null) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((p) => p.id !== id);
    });
    setStatus('idle');
    setCardCount(0);
    setVerbatimEmptyState(false);
    setError(null);
  };

  type ConvertOutcome =
    | { cardCount: number }
    | { error: string }
    | { noQuestions: true };

  const convertOnePhoto = async (
    photo: SelectedPhoto,
    name: string,
    activeMode: PhotoMode
  ): Promise<ConvertOutcome> => {
    let prepared: PreparedImage;
    try {
      prepared = await prepareImageForVision(photo.file);
    } catch (decodeError) {
      return {
        error:
          decodeError instanceof Error
            ? decodeError.message
            : t('photo.readError'),
      };
    }

    const res = await fetch('/api/image-occlusion/photo-to-deck', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: prepared.base64,
        mediaType: prepared.mediaType,
        deckName: name,
        width: prepared.width,
        height: prepared.height,
        includeSourceImage,
        density,
        mode: activeMode,
        mcqEnabled: includeMcq && isPaying,
      }),
    });

    if (res.status === 404) {
      return { error: t('photo.notAvailable') };
    }
    if (res.status === 401 || res.status === 403) {
      return { error: t('photo.signIn') };
    }
    if (res.status === 413) {
      return {
        error: t('photo.tooLarge'),
      };
    }
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as {
        used?: number;
        limit?: number;
      };
      const limit = body.limit ?? 5;
      const used = body.used ?? limit;
      track('photo_quota_reached', { used, limit });
      return {
        error: t('photo.quotaReached', { limit }),
      };
    }
    if (res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      if (body.code === 'no_ready_made_questions') {
        return { noQuestions: true };
      }
      return { error: body.message ?? t('photo.genericReadError') };
    }
    if (!res.ok) {
      const body = (await res
        .json()
        .catch(() => ({ message: res.statusText }))) as { message?: string };
      return { error: body.message ?? t('photo.genericReadError') };
    }

    const count = Number(res.headers.get('X-Card-Count') ?? '0');
    const blob = await res.blob();
    downloadBlob(blob, `${name}.apkg`);
    return { cardCount: count };
  };

  const buildDeckName = (
    photo: SelectedPhoto,
    index: number,
    total: number
  ): string => {
    const trimmed = deckName.trim();
    const fallback =
      photo.file.name.replace(/\.[^.]+$/, '') || t('photo.deckFallback');
    if (trimmed.length === 0) return fallback;
    return total === 1 ? trimmed : `${trimmed} ${index + 1}`;
  };

  const runConversion = async (activeMode: PhotoMode) => {
    if (photos.length === 0) {
      setError(t('photo.addFirst'));
      return;
    }
    setError(null);
    setVerbatimEmptyState(false);
    setStatus('reading');
    track('photo_upload_started', { source: uploadSource });

    let totalCards = 0;

    try {
      for (let i = 0; i < photos.length; i += 1) {
        const photo = photos[i];
        const name = buildDeckName(photo, i, photos.length);
        const result = await convertOnePhoto(photo, name, activeMode);
        if ('error' in result) {
          setError(result.error);
          setStatus('idle');
          return;
        }
        if ('noQuestions' in result) {
          setVerbatimEmptyState(true);
          setStatus('idle');
          track('photo_verbatim_no_questions');
          return;
        }
        totalCards += result.cardCount;
      }

      setCardCount(totalCards);
      setStatus('done');
    } catch {
      setError(t('photo.somethingBroke'));
      setStatus('idle');
    }
  };

  const handleConvert = () => runConversion(mode);

  const retryWithGenerative = () => {
    setMode('generative');
    setVerbatimEmptyState(false);
    card1Ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    track('photo_verbatim_switch_to_generate');
    void runConversion('generative');
  };

  const renderConvertLabel = (): string => {
    if (status === 'reading') {
      return photoCount > 1
        ? t('photo.readingPhotos', { count: photoCount })
        : t('photo.readingPhoto');
    }
    return photoCount > 1
      ? t('photo.getCardsFromPhotos', { count: photoCount })
      : t('photo.getCards');
  };

  const renderSuccessLabel = (): string => {
    const cards = t('photo.cardCount', { count: cardCount });
    if (photoCount > 1) {
      return t('photo.successMultiple', { cards, photoCount });
    }
    return t('photo.successSingle', { cards });
  };

  return (
    <section className={pageStyles.page} aria-label={t('photo.title')}>
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>{t('photo.title')}</h1>
        <p className={styles.subtitle}>
          {t('photo.subtitle')}
          {!isPaying && t('photo.freePlanSuffix')}
        </p>
      </header>

      <div ref={card1Ref} className={styles.sectionCard} data-section-card>
        <div
          className={pageStyles.modeGroup}
          role="radiogroup"
          aria-label={t('photo.modeGroupLabel')}
        >
          <button
            type="button"
            role="radio"
            aria-label={t('photo.generateLabel')}
            aria-checked={mode === 'generative'}
            className={`${pageStyles.modeCard} ${mode === 'generative' ? pageStyles.modeCardActive : ''}`}
            onClick={() => setMode('generative')}
          >
            <span className={pageStyles.modeCardTitle} aria-hidden>
              {t('photo.generateLabel')}
            </span>
            <span className={pageStyles.modeCardHelper}>
              {t('photo.generateHelper')}
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-label={t('photo.copyLabel')}
            aria-checked={mode === 'verbatim'}
            className={`${pageStyles.modeCard} ${mode === 'verbatim' ? pageStyles.modeCardActive : ''}`}
            onClick={() => setMode('verbatim')}
          >
            <span className={pageStyles.modeCardTitle} aria-hidden>
              {t('photo.copyLabel')}
            </span>
            <span className={pageStyles.modeCardHelper}>
              {t('photo.copyHelper')}
            </span>
          </button>
        </div>
      </div>

      <div className={styles.sectionCard} data-section-card>
        <div className={pageStyles.row}>
          <label className={pageStyles.deckNameLabel} htmlFor="photo-deck-name">
            {t('photo.deckName')}
          </label>
          <input
            id="photo-deck-name"
            type="text"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            className={pageStyles.deckNameInput}
            placeholder={
              photos[0]?.file.name.replace(/\.[^.]+$/, '') ||
              t('photo.deckFallback')
            }
          />
        </div>

        <div className={pageStyles.cameraButtonContainer}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => cameraInputRef.current?.click()}
          >
            {t('photo.takePhoto')}
          </button>
          <input
            ref={cameraInputRef}
            id="photo-camera-input"
            type="file"
            accept={PICKER_ACCEPT}
            capture="environment"
            onChange={handleCameraInput}
            hidden
          />
        </div>

        <p className={pageStyles.dropzoneLabel}>{t('photo.orPick')}</p>

        <label
          className={pageStyles.dropzone}
          htmlFor="photo-file-input"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onPaste={handlePaste}
        >
          {photoCount === 0 ? (
            <>
              <span className={pageStyles.dropzoneTitle}>
                {t('photo.dropTitle')}
              </span>
              <span className={pageStyles.dropzoneHint}>
                {t('photo.dropHint')}
              </span>
            </>
          ) : (
            <>
              <span className={pageStyles.dropzoneTitle}>
                {t('photo.addMoreTitle')}
              </span>
              <span className={pageStyles.dropzoneHint}>
                {t('photo.photosReady', { count: photoCount })}
              </span>
            </>
          )}
          <input
            ref={fileInputRef}
            id="photo-file-input"
            type="file"
            accept={PICKER_ACCEPT}
            multiple
            onChange={handleFileInput}
            hidden
          />
        </label>

        {photoCount > 0 && (
          <ul
            className={pageStyles.thumbnailStrip}
            aria-label={t('photo.photosSelected', { count: photoCount })}
          >
            {photos.map((photo) => (
              <li key={photo.id} className={pageStyles.thumbnail}>
                <img
                  src={photo.previewUrl}
                  alt={photo.file.name}
                  className={pageStyles.thumbnailImage}
                />
                <button
                  type="button"
                  className={pageStyles.thumbnailRemove}
                  aria-label={t('photo.removePhoto', { name: photo.file.name })}
                  onClick={(e) => {
                    e.preventDefault();
                    removePhoto(photo.id);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mode === 'generative' && (
        <div className={styles.sectionCard} data-section-card>
          <div className={pageStyles.row}>
            <label
              className={pageStyles.deckNameLabel}
              htmlFor="photo-card-count"
            >
              {t('photo.howManyCards')}
            </label>
            <input
              id="photo-card-count"
              type="number"
              min={MIN_CARDS}
              max={MAX_CARDS}
              value={targetCardCount}
              onChange={handleCardCountChange}
              className={pageStyles.deckNameInput}
            />
          </div>
          <p className={pageStyles.densityHint}>{t('photo.densityHint')}</p>
        </div>
      )}

      <div className={styles.sectionCard} data-section-card>
        <label className={pageStyles.checkboxRow}>
          <span className={pageStyles.toggleSwitch}>
            <input
              type="checkbox"
              role="switch"
              checked={includeSourceImage}
              onChange={(e) => setIncludeSourceImage(e.target.checked)}
            />
            <span className={pageStyles.toggleSwitchTrack} aria-hidden />
          </span>
          {t('photo.showSourceImage')}
        </label>
        <p className={pageStyles.densityHint}>{t('photo.showSourceHint')}</p>

        <label className={pageStyles.checkboxRow}>
          <span className={pageStyles.toggleSwitch}>
            <input
              type="checkbox"
              role="switch"
              checked={isPaying && includeMcq}
              disabled={!isPaying}
              onChange={(e) => {
                const next = e.target.checked;
                setIncludeMcq(next);
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem(
                    MCQ_ENABLED_STORAGE_KEY,
                    String(next)
                  );
                }
              }}
            />
            <span className={pageStyles.toggleSwitchTrack} aria-hidden />
          </span>
          {t('photo.includeMcq')}
        </label>
        <p className={pageStyles.densityHint}>
          {isPaying ? (
            t('photo.mcqPayingHint')
          ) : (
            <>
              <Link
                to="/pricing?from=photo-mcq"
                className={pageStyles.densityHintLink}
              >
                {t('photo.upgrade')}
              </Link>
              {t('photo.mcqUpgradeHint')}
            </>
          )}
        </p>
      </div>

      {error != null && (
        <div className={styles.notificationDanger}>{error}</div>
      )}

      {status === 'done' && !verbatimEmptyState && (
        <div className={styles.notificationSuccess}>{renderSuccessLabel()}</div>
      )}

      {verbatimEmptyState && (
        <div className={styles.notificationWarning}>
          {t('photo.noQuestionsFound')}{' '}
          <button
            type="button"
            className={pageStyles.switchModeLink}
            onClick={retryWithGenerative}
          >
            {t('photo.switchToGenerate')}
          </button>
          {t('photo.switchSuffix')}
        </div>
      )}

      <div className={pageStyles.footer}>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={reset}
          disabled={photoCount === 0 && status === 'idle'}
        >
          {t('photo.clear')}
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={handleConvert}
          disabled={photoCount === 0 || status === 'reading'}
        >
          {renderConvertLabel()}
        </button>
      </div>
    </section>
  );
}

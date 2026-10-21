import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import styles from './PrintForm.module.css';
import sharedStyles from '../../../styles/shared.module.css';

export type PrintPreviewState = 'rendering' | 'ready' | 'empty' | 'error';

interface PrintPreviewProps {
  state: PrintPreviewState;
  imageSrc: string | null;
  totalCards: number;
  previewedCards: number;
  paying: boolean;
  freePrintAvailable: boolean | null;
  optionsChanged: boolean;
  downloadBusy: boolean;
  passBusy: boolean;
  errorMessage: string | null;
  downloadError?: ReactNode;
  onUpdatePreview: () => void;
  onDownload: () => void;
  onPass: () => void;
  onPreviewAnother: () => void;
}

export default function PrintPreview({
  state,
  imageSrc,
  totalCards,
  previewedCards,
  paying,
  freePrintAvailable,
  optionsChanged,
  downloadBusy,
  passBusy,
  errorMessage,
  downloadError = null,
  onUpdatePreview,
  onDownload,
  onPass,
  onPreviewAnother,
}: PrintPreviewProps) {
  const { t } = useTranslation('tools');
  const [zoomed, setZoomed] = useState(false);

  if (state === 'rendering') {
    return (
      <div
        className={sharedStyles.notificationInfo}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginTop: '1rem',
        }}
        aria-busy="true"
      >
        <div className={sharedStyles.spinnerSmall} />
        <span>{t('print.makingPreview')}</span>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={styles.previewPanel}>
        <p className={sharedStyles.notificationDanger}>{errorMessage}</p>
        <div className={styles.previewActions}>
          <button
            type="button"
            className={sharedStyles.btnSecondary}
            onClick={onPreviewAnother}
          >
            {t('print.previewAnother')}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className={styles.previewPanel}>
        <p className={sharedStyles.notificationInfo}>{t('print.emptyDeck')}</p>
        <div className={styles.previewActions}>
          <button
            type="button"
            className={sharedStyles.btnSecondary}
            onClick={onPreviewAnother}
          >
            {t('print.previewAnother')}
          </button>
        </div>
      </div>
    );
  }

  const caption =
    previewedCards >= totalCards
      ? t('print.previewAll', { count: previewedCards })
      : t('print.previewOfTotal', { count: previewedCards, total: totalCards });
  const freePrintUsed = !paying && freePrintAvailable === false;

  return (
    <div className={styles.previewPanel}>
      <p className={styles.previewLede}>{t('print.previewIsFree')}</p>
      <figure className={styles.previewFigure}>
        <div className={styles.previewImageWrap} data-zoomed={zoomed}>
          <button
            type="button"
            className={styles.previewImageButton}
            aria-label={caption}
            aria-pressed={zoomed}
            onClick={() => setZoomed((value) => !value)}
          >
            {imageSrc != null && (
              <img src={imageSrc} alt="" className={styles.previewImage} />
            )}
          </button>
        </div>
        <figcaption className={styles.previewCaption}>
          <span className={styles.previewCaptionLine}>{caption}</span>
          <span className={styles.previewCaptionNote}>
            {t('print.previewPaperNote')}
          </span>
        </figcaption>
      </figure>

      {optionsChanged && (
        <button
          type="button"
          className={sharedStyles.btnOutline}
          onClick={onUpdatePreview}
        >
          {t('print.updatePreview')}
        </button>
      )}

      {downloadError}

      <div className={styles.previewActions}>
        {freePrintUsed ? (
          <>
            <button
              type="button"
              className={sharedStyles.btnPrimary}
              onClick={onPass}
              disabled={passBusy}
            >
              {t('print.unlockWithPass')}
            </button>
            <Link to="/pricing" className={styles.previewTertiaryLink}>
              {t('print.seeAllPlans')}
            </Link>
          </>
        ) : (
          <>
            <button
              type="button"
              className={sharedStyles.btnPrimary}
              onClick={onDownload}
              disabled={downloadBusy}
            >
              {t('print.downloadFullPdf')}
            </button>
            {!paying && (
              <span className={styles.previewHint}>
                {t('print.usesFreePdf')}
              </span>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className={styles.previewAnotherLink}
        onClick={onPreviewAnother}
      >
        {t('print.previewAnother')}
      </button>
    </div>
  );
}

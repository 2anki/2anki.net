import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import sharedStyles from '../../styles/shared.module.css';
import { HANDOFF_FILE_STATE_KEY } from '../../lib/deckUpload/deckUploadAnswer';
import { track } from '../../lib/analytics/track';
import styles from './DeckUpload.module.css';

interface Props {
  file: File;
  onCancel: () => void;
}

// A zip of notes dropped on a deck tool: take it to the converter, file and
// all, instead of turning it away.
export default function NotADeckHandoff({ file, onCancel }: Readonly<Props>) {
  const { t } = useTranslation('tools');
  const navigate = useNavigate();
  return (
    <div className={styles.panel} role="status">
      <p className={styles.title}>{t('deckUpload.notADeckBody')}</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
          onClick={() => {
            track('apkg_upload_handoff_clicked', { to: 'upload' });
            navigate('/upload', { state: { [HANDOFF_FILE_STATE_KEY]: file } });
          }}
        >
          {t('deckUpload.notADeckAction')}
        </button>
        <button type="button" className={styles.link} onClick={onCancel}>
          {t('deckUpload.chooseAnother')}
        </button>
      </div>
    </div>
  );
}

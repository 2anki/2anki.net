import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import sharedStyles from '../../styles/shared.module.css';
import { deckLabel } from '../../lib/deckUpload/deckUploadAnswer';
import styles from './DeckUpload.module.css';

interface Props {
  decks: string[];
  actionLabel: string;
  onChoose: (entry: string) => void;
  onCancel: () => void;
}

export default function DeckChoice({
  decks,
  actionLabel,
  onChoose,
  onCancel,
}: Readonly<Props>) {
  const { t } = useTranslation('tools');
  const name = useId();
  const [chosen, setChosen] = useState(decks[0] ?? '');
  return (
    <fieldset className={styles.panel}>
      <legend className={styles.title}>
        {t('deckUpload.chooseTitle', { n: decks.length })}
      </legend>
      <div className={styles.options}>
        {decks.map((entry) => (
          <label key={entry} className={styles.option}>
            <input
              type="radio"
              name={name}
              value={entry}
              checked={chosen === entry}
              onChange={() => setChosen(entry)}
            />
            <span>{deckLabel(entry)}</span>
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
          onClick={() => onChoose(chosen)}
          disabled={chosen === ''}
        >
          {actionLabel}
        </button>
        <button type="button" className={styles.link} onClick={onCancel}>
          {t('deckUpload.chooseAnother')}
        </button>
      </div>
    </fieldset>
  );
}

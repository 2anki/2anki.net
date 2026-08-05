import styles from '../DownloadsPage.module.css';
import sharedStyles from '../../../styles/shared.module.css';

interface ConversionNoteToggleProps {
  badge: string;
  controlsId: string;
  tone: 'neutral' | 'warning';
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * A conversion signal that has something to say gets its own chip on the row.
 * The badge text is the accessible name: a "Show skipped blocks" style label
 * would promise a scoped disclosure the row does not have, since every chip
 * opens the one shared panel that stacks all applicable notices.
 */
export function ConversionNoteToggle({
  badge,
  controlsId,
  tone,
  isExpanded,
  onToggle,
}: Readonly<ConversionNoteToggleProps>) {
  return (
    <button
      type="button"
      className={styles.statusToggle}
      onClick={onToggle}
      aria-controls={controlsId}
      aria-expanded={isExpanded}
    >
      <span
        className={
          tone === 'warning' ? sharedStyles.badgeWarning : sharedStyles.badge
        }
      >
        {badge}
      </span>
      <span
        aria-hidden="true"
        className={`${styles.statusChevron} ${isExpanded ? styles.statusChevronExpanded : ''}`}
      >
        ▾
      </span>
    </button>
  );
}

export default ConversionNoteToggle;

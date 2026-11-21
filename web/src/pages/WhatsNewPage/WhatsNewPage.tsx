import { useTranslation } from 'react-i18next';
import { FeedbackWidget } from '../../components/FeedbackWidget/FeedbackWidget';
import { useAppLanguage } from '../../lib/i18n/useAppLanguage';
import { changelog, ChangelogEntry } from './changelog/index';
import sharedStyles from '../../styles/shared.module.css';
import styles from './WhatsNewPage.module.css';

interface DateGroup {
  date: string;
  label: string;
  entries: ChangelogEntry[];
}

const TYPE_ORDER: Record<string, number> = { feature: 0, style: 1, fix: 2 };

const TYPE_LABEL_KEYS: Record<string, string> = {
  feature: 'whatsNew.badgeNew',
  fix: 'whatsNew.badgeFix',
  style: 'whatsNew.badgeDesign',
};

function groupByDate(entries: ChangelogEntry[], language: string): DateGroup[] {
  const map = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const group = map.get(entry.date);
    if (group) {
      group.push(entry);
    } else {
      map.set(entry.date, [entry]);
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({
      date,
      label: formatGroupDate(date, language),
      entries: items
        .slice()
        .sort((a, b) => (TYPE_ORDER[a.type] ?? 3) - (TYPE_ORDER[b.type] ?? 3)),
    }));
}

const formatGroupDate = (dateStr: string, language: string): string => {
  const date = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(language, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export default function WhatsNewPage() {
  const { t } = useTranslation('chrome');
  const language = useAppLanguage();
  const shipped = groupByDate(changelog, language);

  return (
    <div className={sharedStyles.page}>
      <header className={sharedStyles.pageHeader}>
        <h1 className={sharedStyles.title}>{t('whatsNew.title')}</h1>
        <p className={sharedStyles.subtitle}>{t('whatsNew.subtitle')}</p>
        <div className={styles.inlineRating}>
          <span className={styles.ratingPrompt}>
            {t('whatsNew.ratingPrompt')}
          </span>
          <FeedbackWidget page="/whats-new" compact />
          <a
            href="https://github.com/2anki/server/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.reportLink}
          >
            {t('whatsNew.reportIssue')}
          </a>
        </div>
      </header>

      <div className={styles.board}>
        {shipped.length === 0 ? (
          <p className={styles.emptyState}>{t('whatsNew.empty')}</p>
        ) : (
          <div className={styles.timeline}>
            {shipped.map((group) => (
              <div key={group.date} className={styles.dateGroup}>
                <h3 className={styles.dateHeading}>{group.label}</h3>
                <ul className={styles.commitList}>
                  {group.entries.map((entry, idx) => (
                    <li
                      key={`${entry.date}-${idx}`}
                      className={styles.commitItem}
                    >
                      <span
                        className={`${styles.typeBadge} ${styles['badge_' + entry.type]}`}
                      >
                        {TYPE_LABEL_KEYS[entry.type]
                          ? t(TYPE_LABEL_KEYS[entry.type])
                          : entry.type}
                      </span>
                      <span className={styles.commitText} lang="en">
                        {entry.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { DeckQualityCohort } from './conversionTypes';
import styles from './OpsPage.module.css';

const ENGINE_LABELS: Record<string, string> = {
  parser: 'Parser',
  claude: 'Claude',
};

function formatScore(value: number | null): string {
  return value == null ? '—' : value.toFixed(2);
}

function formatRate(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number | null): string {
  return value == null ? '—' : value.toLocaleString('en-US');
}

export default function DeckQualitySection({
  cohorts,
}: {
  cohorts: DeckQualityCohort[] | null;
}) {
  return (
    <section className={styles.section} aria-labelledby="conv-section-quality">
      <header className={styles.sectionHeader}>
        <h2 id="conv-section-quality" className={styles.sectionTitle}>
          Deck quality
        </h2>
        <p className={styles.sectionHint}>
          Score distribution per engine and format, last 30 days. Percentiles
          appear once a cohort has enough conversions to mean anything.
        </p>
      </header>
      {cohorts == null || cohorts.length === 0 ? (
        <p className={styles.emptyHint}>
          No scored conversions yet. The table fills as conversions run.
        </p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Engine</th>
                <th>Format</th>
                <th>Scored</th>
                <th>No cards</th>
                <th>p10</th>
                <th>Median</th>
                <th>p90</th>
                <th>Cards</th>
                <th>Back length</th>
                <th>Blank backs p90</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => (
                <tr key={`${cohort.engine}-${cohort.input_format}`}>
                  <td>{ENGINE_LABELS[cohort.engine] ?? cohort.engine}</td>
                  <td>{cohort.input_format}</td>
                  <td className={styles.numeric}>
                    {formatCount(cohort.sample_size)}
                    {!cohort.enough_data && (
                      <span className={styles.sectionHint}> too few</span>
                    )}
                  </td>
                  <td className={styles.numeric}>
                    {formatRate(cohort.no_cards_rate)}
                  </td>
                  <td className={styles.numeric}>
                    {formatScore(cohort.composite_p10)}
                  </td>
                  <td className={styles.numeric}>
                    {formatScore(cohort.composite_p50)}
                  </td>
                  <td className={styles.numeric}>
                    {formatScore(cohort.composite_p90)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCount(cohort.card_count_p50)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCount(cohort.median_back_len_p50)}
                  </td>
                  <td className={styles.numeric}>
                    {formatRate(cohort.blank_back_rate_p90)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

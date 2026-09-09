import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { buildClaudePrompt } from './buildClaudePrompt';
import CopyForClaudeButton from './CopyForClaudeButton';
import { useOpsWindow } from './opsWindow';
import { useUploadFunnel } from './useUploadFunnel';
import {
  UploadFunnelOriginBreakdown,
  UploadFunnelStages,
} from './uploadFunnelTypes';

const THIN_SPACE = '\u2009';

const DIRECT_ORIGIN_LABEL = 'Direct / unknown';

function originLabel(origin: string | null): string {
  return origin == null || origin.trim() === '' ? DIRECT_ORIGIN_LABEL : origin;
}

function renderOriginRows(byOrigin: UploadFunnelOriginBreakdown[]) {
  if (byOrigin.length === 0) {
    return (
      <p className={styles.emptyHint}>
        No origin-attributed events in this window yet.
      </p>
    );
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Origin</th>
            <th>Uploaded</th>
            <th>Downloaded</th>
            <th>Signed up</th>
            <th>Purchased</th>
            <th>Upload \u2192 download</th>
            <th>Download \u2192 paid</th>
          </tr>
        </thead>
        <tbody>
          {byOrigin.map((row) => (
            <tr key={row.origin ?? DIRECT_ORIGIN_LABEL}>
              <td>{originLabel(row.origin)}</td>
              <td className={styles.numeric}>
                {formatCount(row.stages.upload_started)}
              </td>
              <td className={styles.numeric}>
                {formatCount(row.stages.deck_downloaded)}
              </td>
              <td className={styles.numeric}>
                {formatCount(row.stages.signup)}
              </td>
              <td className={styles.numeric}>{formatCount(row.stages.paid)}</td>
              <td className={styles.numeric}>
                {formatRate(row.upload_to_download_rate_pct)}
              </td>
              <td className={styles.numeric}>
                {formatRate(row.download_to_paid_rate_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function formatCount(n: number): string {
  if (n < 10000) {
    return String(n);
  }
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

export function formatRate(n: number): string {
  return `${n.toFixed(1)}%`;
}

interface CountTile {
  key: keyof UploadFunnelStages;
  label: string;
  muted: boolean;
}

const COUNT_TILES: CountTile[] = [
  { key: 'upload_started', label: 'Upload started', muted: false },
  { key: 'conversion_succeeded', label: 'Conversion succeeded', muted: false },
  { key: 'deck_downloaded', label: 'Deck downloaded', muted: false },
  { key: 'paywall_shown', label: 'Paywall shown', muted: false },
  { key: 'signup', label: 'Signup', muted: false },
  { key: 'paid', label: 'Paid', muted: false },
  { key: 'conversion_failed', label: 'Conversion failed', muted: true },
];

interface RateHero {
  label: string;
  rate: number;
  numerator: keyof UploadFunnelStages;
  denominator: keyof UploadFunnelStages;
  numeratorNoun: string;
  denominatorNoun: string;
  emptyFootnote: string;
}

export default function UploadFunnelTab() {
  const window = useOpsWindow();
  const { data, error, isLoading } = useUploadFunnel(window);

  const stages = data?.stages ?? null;

  const rateHeroes: RateHero[] = [
    {
      label: 'Upload to download',
      rate: data?.upload_to_download_rate_pct ?? 0,
      numerator: 'deck_downloaded',
      denominator: 'upload_started',
      numeratorNoun: 'a download',
      denominatorNoun: 'uploads',
      emptyFootnote: 'No uploads in this window',
    },
    {
      label: 'Download to signup',
      rate: data?.download_to_signup_rate_pct ?? 0,
      numerator: 'signup',
      denominator: 'deck_downloaded',
      numeratorNoun: 'signup',
      denominatorNoun: 'downloads',
      emptyFootnote: 'No downloads in this window',
    },
    {
      label: 'Download to paid',
      rate: data?.download_to_paid_rate_pct ?? 0,
      numerator: 'paid',
      denominator: 'deck_downloaded',
      numeratorNoun: 'a paid plan',
      denominatorNoun: 'downloads',
      emptyFootnote: 'No downloads in this window',
    },
  ];

  return (
    <>
      <p className={styles.panelTitle}>Upload funnel</p>
      <p className={styles.panelSubtitle}>
        Distinct-identity counts per stage, from upload through signup to paid.
      </p>

      <div className={styles.tabHeader}>
        <div className={styles.controls}>
          <CopyForClaudeButton
            getText={() =>
              data == null ? '' : buildClaudePrompt('upload-funnel', data)
            }
            disabled={data == null}
          />
        </div>
      </div>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {error.message}
        </div>
      )}

      {data?.error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {data.error}
        </div>
      )}

      {stages != null && (
        <>
          {rateHeroes.map((hero) => {
            const denominatorCount = stages[hero.denominator];
            const numeratorCount = stages[hero.numerator];
            return (
              <div
                key={hero.label}
                className={`${sharedStyles.surface} ${styles.rateHero}`}
              >
                <p className={styles.rateHeroLabel}>{hero.label}</p>
                <p className={styles.rateHeroValue}>{formatRate(hero.rate)}</p>
                <p className={styles.rateHeroFootnote}>
                  {denominatorCount > 0
                    ? `${formatCount(numeratorCount)} of ${formatCount(denominatorCount)} ${hero.denominatorNoun} reached ${hero.numeratorNoun}`
                    : hero.emptyFootnote}
                </p>
              </div>
            );
          })}

          <div className={styles.cardGrid}>
            {COUNT_TILES.map((tile) => (
              <div
                key={tile.key}
                className={
                  tile.muted
                    ? `${sharedStyles.surface} ${styles.card} ${styles.cardMuted}`
                    : `${sharedStyles.surface} ${styles.card}`
                }
              >
                <p className={styles.cardTitle}>{tile.label}</p>
                <p className={styles.cardValue}>
                  {formatCount(stages[tile.key])}
                </p>
              </div>
            ))}
          </div>

          <p className={styles.panelSubtitle}>
            By origin — where each identity first arrived (attributed from the
            first-touch cookie), ordered by upload volume.
          </p>
          {renderOriginRows(data?.by_origin ?? [])}
        </>
      )}

      {isLoading && data == null && (
        <p className={styles.emptyHint}>Reading the funnel</p>
      )}
    </>
  );
}

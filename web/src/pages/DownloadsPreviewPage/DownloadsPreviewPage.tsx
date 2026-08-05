import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConversionNoteToggle } from '../DownloadsPage/components/ConversionNoteToggle';
import { countUnsupportedBlocks } from '../DownloadsPage/helpers/countUnsupportedBlocks';
import styles from '../DownloadsPage/DownloadsPage.module.css';
import sharedStyles from '../../styles/shared.module.css';

/**
 * The trio split on this surface: designer argued one badge per signal so the
 * fact is glanceable, pm and engineer argued one shared chip so a row cannot
 * stack four. Both are rendered here against every density the payload builder
 * can actually produce, so the call is made against pixels rather than prose.
 */

interface Signals {
  forbiddenBlocks: { count: number } | null;
  unsupportedBlocks: Record<string, number> | null;
  structureRescued: { rule: string } | null;
  guessedColumns: { frontField: string; backField: string } | null;
  droppedAssets: number | null;
  truncation: boolean;
}

const NO_SIGNALS: Signals = {
  forbiddenBlocks: null,
  unsupportedBlocks: null,
  structureRescued: null,
  guessedColumns: null,
  droppedAssets: null,
  truncation: false,
};

const CASES: ReadonlyArray<{ title: string; note: string; signals: Signals }> =
  [
    {
      title: 'Pure 403 — the case #3972 targets',
      note: 'code=notion_blocks_forbidden, nothing riding along. Today this row has no affordance at all.',
      signals: { ...NO_SIGNALS, forbiddenBlocks: { count: 3 } },
    },
    {
      title: 'One unshared block',
      note: 'Singular plural form.',
      signals: { ...NO_SIGNALS, forbiddenBlocks: { count: 1 } },
    },
    {
      title: 'Structure rescued',
      note: 'code=notion_structure_rescued. An inference, nothing lost, so neutral tone.',
      signals: { ...NO_SIGNALS, structureRescued: { rule: 'heading' } },
    },
    {
      title: 'Columns guessed',
      note: 'Database path. Field-gated, so it can also ride along with any code.',
      signals: {
        ...NO_SIGNALS,
        guessedColumns: { frontField: 'Term', backField: 'Definition' },
      },
    },
    {
      title: 'Unsupported blocks only',
      note: 'code=notion_unsupported_blocks.',
      signals: { ...NO_SIGNALS, unsupportedBlocks: { pdf: 2, embed: 1 } },
    },
    {
      title: 'Two chips — forbidden plus dropped images',
      note: 'dropped_assets is field-gated and rides along with any winning code.',
      signals: {
        ...NO_SIGNALS,
        forbiddenBlocks: { count: 2 },
        droppedAssets: 1,
      },
    },
    {
      title: 'Three chips',
      note: 'Forbidden wins the code slot, dropped assets and unsupported blocks both ride along.',
      signals: {
        ...NO_SIGNALS,
        forbiddenBlocks: { count: 2 },
        droppedAssets: 1,
        unsupportedBlocks: { pdf: 4 },
      },
    },
    {
      title: 'Four chips — the density worst case',
      note: 'One code-gated signal plus all three field-gated ones. Rare, but the payload builder permits it.',
      signals: {
        truncation: true,
        droppedAssets: 2,
        unsupportedBlocks: { pdf: 4, embed: 2 },
        guessedColumns: { frontField: 'Term', backField: 'Definition' },
        forbiddenBlocks: null,
        structureRescued: null,
      },
    },
  ];

function PerSignalRow({
  signals,
  isExpanded,
  onToggle,
}: Readonly<{ signals: Signals; isExpanded: boolean; onToggle: () => void }>) {
  const { t } = useTranslation();

  return (
    <>
      {signals.truncation && (
        <ConversionNoteToggle
          badge={t('downloads.badge.partial')}
          controlsId="preview-panel"
          tone="neutral"
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      )}
      {signals.droppedAssets != null && (
        <ConversionNoteToggle
          badge={t('downloads.badge.imageSkipped', {
            count: signals.droppedAssets,
          })}
          controlsId="preview-panel"
          tone="warning"
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      )}
      {signals.forbiddenBlocks != null && (
        <ConversionNoteToggle
          badge={t('downloads.badge.blocksForbidden', {
            count: signals.forbiddenBlocks.count,
          })}
          controlsId="preview-panel"
          tone="warning"
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      )}
      {signals.unsupportedBlocks != null && (
        <ConversionNoteToggle
          badge={t('downloads.badge.blocksSkipped', {
            count: countUnsupportedBlocks(signals.unsupportedBlocks),
          })}
          controlsId="preview-panel"
          tone="warning"
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      )}
      {signals.structureRescued != null && (
        <ConversionNoteToggle
          badge={t('downloads.badge.structureGuessed')}
          controlsId="preview-panel"
          tone="neutral"
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      )}
      {signals.guessedColumns != null && (
        <ConversionNoteToggle
          badge={t('downloads.badge.columnsGuessed')}
          controlsId="preview-panel"
          tone="neutral"
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      )}
    </>
  );
}

function pickSharedBadge(signals: Signals, t: (key: string) => string): string {
  if (signals.structureRescued != null) {
    return t('downloads.badge.structureGuessed');
  }
  if (signals.forbiddenBlocks != null) return t('downloads.badge.partial');
  if (signals.truncation) return t('downloads.badge.partial');
  if (signals.guessedColumns != null) {
    return t('downloads.badge.columnsGuessed');
  }
  return t('downloads.badge.partial');
}

function SharedToggleRow({
  signals,
  isExpanded,
  onToggle,
}: Readonly<{ signals: Signals; isExpanded: boolean; onToggle: () => void }>) {
  const { t } = useTranslation();

  return (
    <ConversionNoteToggle
      badge={pickSharedBadge(signals, t)}
      controlsId="preview-panel"
      tone="neutral"
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  );
}

function Cell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        flexWrap: 'wrap',
        padding: '0.5rem 0',
      }}
    >
      {children}
    </div>
  );
}

export function DownloadsPreviewPage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className={sharedStyles.page}>
      <h1 className="title">Downloads conversion notes</h1>
      <p className="subtitle">
        Candidate A is one badge per signal. Candidate B is a single shared chip
        with a priority-picked label. Same rows, same data, side by side.
      </p>

      <table className={styles.table}>
        <thead>
          <tr>
            <th style={{ width: '30%' }}>Case</th>
            <th>A — per signal</th>
            <th>B — one shared chip</th>
          </tr>
        </thead>
        <tbody>
          {CASES.map((testCase) => (
            <tr key={testCase.title}>
              <td>
                <strong>{testCase.title}</strong>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-tertiary)',
                  }}
                >
                  {testCase.note}
                </div>
              </td>
              <td>
                <Cell>
                  <PerSignalRow
                    signals={testCase.signals}
                    isExpanded={expanded === `a-${testCase.title}`}
                    onToggle={() =>
                      setExpanded((current) =>
                        current === `a-${testCase.title}`
                          ? null
                          : `a-${testCase.title}`
                      )
                    }
                  />
                </Cell>
              </td>
              <td>
                <Cell>
                  <SharedToggleRow
                    signals={testCase.signals}
                    isExpanded={expanded === `b-${testCase.title}`}
                    onToggle={() =>
                      setExpanded((current) =>
                        current === `b-${testCase.title}`
                          ? null
                          : `b-${testCase.title}`
                      )
                    }
                  />
                </Cell>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DownloadsPreviewPage;

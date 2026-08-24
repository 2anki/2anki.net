import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversionReportModal } from './ConversionReportModal';
import '../../../../lib/i18n';
import JobResponse from '../../../../schemas/public/JobResponse';
import { JobsId } from '../../../../schemas/public/Jobs';
import type { ConversionReport } from '../../../../lib/interfaces/ConversionReport';

const mockGetJobReport = vi.fn();

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    getJobReport: mockGetJobReport,
  }),
}));

vi.mock('../../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

import { track } from '../../../../lib/analytics/track';

const buildJob = (overrides: Partial<JobResponse> = {}): JobResponse =>
  ({
    id: 1 as JobsId,
    owner: 'owner-1',
    object_id: 'page-1',
    status: 'done',
    created_at: new Date('2026-08-20T11:30:00Z'),
    last_edited_time: new Date('2026-08-20T11:30:00Z'),
    title: 'Notion deck',
    type: 'page',
    job_reason_failure: null,
    card_count: 34,
    restartable: true,
    download_key: 'deck.apkg',
    upload_id: null,
    ...overrides,
  }) as JobResponse;

const storedReport: ConversionReport = {
  summary: { blocks_seen: 52, cards_created: 34, blocks_skipped: 5 },
  entries: [
    {
      stage: 'card',
      reason_code: 'empty_back',
      human_reason: 'Cards whose back came out empty',
      count: 2,
    },
    {
      stage: 'block',
      reason_code: 'blocks_forbidden',
      human_reason: 'Blocks in parts of the page that are not shared',
      count: 1,
    },
    {
      stage: 'block',
      reason_code: 'unsupported_block:embed',
      human_reason: 'Blocks of a type that cannot become cards yet (embed)',
      count: 2,
    },
  ],
};

describe('ConversionReportModal', () => {
  beforeEach(() => {
    mockGetJobReport.mockReset();
    vi.mocked(track).mockClear();
  });

  it('fetches the report for the job and renders the accounting', async () => {
    mockGetJobReport.mockResolvedValue(storedReport);

    render(<ConversionReportModal job={buildJob()} onClose={vi.fn()} />);

    expect(
      await screen.findByText(/34 cards created, from 52 blocks/)
    ).toBeInTheDocument();
    expect(mockGetJobReport).toHaveBeenCalledWith('page-1');
    expect(screen.getByText('5 skipped')).toBeInTheDocument();
    expect(
      screen.getByText(
        '2 toggles had no answer inside, so no cards were made from them. Add the answer inside each toggle, then convert again.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 part of this page isn't connected to 2anki/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 embed blocks can't become cards yet.")
    ).toBeInTheDocument();
    expect(screen.getByText("Couldn't convert")).toBeInTheDocument();
    expect(screen.getAllByText('Skipped')).not.toHaveLength(0);
  });

  it('renders the clean line when the report has no entries', async () => {
    mockGetJobReport.mockResolvedValue({
      summary: { blocks_seen: 52, cards_created: 34, blocks_skipped: 0 },
      entries: [],
    });

    render(<ConversionReportModal job={buildJob()} onClose={vi.fn()} />);

    expect(
      await screen.findByText('Nothing was skipped — the whole page converted.')
    ).toBeInTheDocument();
  });

  it('tallies the overflow entries the report capped', async () => {
    mockGetJobReport.mockResolvedValue({
      summary: { blocks_seen: 90, cards_created: 10, blocks_skipped: 80 },
      entries: storedReport.entries,
      truncated: true,
      omitted_entry_count: 20,
    });

    render(<ConversionReportModal job={buildJob()} onClose={vi.fn()} />);

    expect(
      await screen.findByText('20 more blocks were skipped for other reasons.')
    ).toBeInTheDocument();
  });

  it('falls back to the legacy signal payload when no report is stored', async () => {
    mockGetJobReport.mockResolvedValue(null);
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_blocks_forbidden',
        forbidden_blocks: 3,
      }),
    });

    render(<ConversionReportModal job={job} onClose={vi.fn()} />);

    expect(
      await screen.findByText(/3 parts of this page aren't connected to 2anki/)
    ).toBeInTheDocument();
  });

  it('renders the clean line for an old job with neither report nor signal', async () => {
    mockGetJobReport.mockResolvedValue(null);

    render(<ConversionReportModal job={buildJob()} onClose={vi.fn()} />);

    expect(
      await screen.findByText('Nothing was skipped — the whole page converted.')
    ).toBeInTheDocument();
  });

  it('fires conversion_report_opened once with the report accounting', async () => {
    mockGetJobReport.mockResolvedValue(storedReport);

    render(<ConversionReportModal job={buildJob()} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('conversion_report_opened', {
        source: 'notion',
        blocks_skipped: 5,
        has_precheck_reason: false,
      })
    );
    expect(
      vi
        .mocked(track)
        .mock.calls.filter(([name]) => name === 'conversion_report_opened')
    ).toHaveLength(1);
  });

  it('falls back to the signal count in the event when no report is stored', async () => {
    mockGetJobReport.mockResolvedValue(null);
    const job = buildJob({
      job_reason_failure: JSON.stringify({ dropped_assets: 4 }),
    });

    render(<ConversionReportModal job={job} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('conversion_report_opened', {
        source: 'notion',
        blocks_skipped: 4,
        has_precheck_reason: false,
      })
    );
  });

  it('closes from the close button', async () => {
    mockGetJobReport.mockResolvedValue(null);
    const onClose = vi.fn();

    render(<ConversionReportModal job={buildJob()} onClose={onClose} />);

    (await screen.findByRole('button', { name: 'Close' })).click();
    expect(onClose).toHaveBeenCalled();
  });
});

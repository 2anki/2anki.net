import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DownloadsPage, renderJobStatusCell } from './DownloadsPage';
import i18n from '../../lib/i18n';
import JobResponse from '../../schemas/public/JobResponse';
import { JobsId } from '../../schemas/public/Jobs';

vi.mock('./hooks/useJobs', () => ({
  default: () => ({
    jobs: mockJobs,
    deleteJob: vi.fn(),
    restartJob: vi.fn(),
    refreshJobs: vi.fn().mockResolvedValue(undefined),
    lastFetchedAt: new Date('2026-05-18T12:00:00Z'),
  }),
}));

vi.mock('./hooks/useUploads', () => ({
  default: () => ({
    uploads: mockUploads,
    loading: false,
    error: null,
    deleteUpload: vi.fn(),
    refreshUploads: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({}),
}));

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: { locals: { patreon: false, subscriber: false } },
  }),
}));

vi.mock('./hooks/useDropboxUploads', () => ({
  default: () => ({
    uploads: mockDropboxUploads,
    loading: false,
    error: false,
    deleteUpload: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
  }),
}));

vi.mock('./hooks/useGoogleDriveUploads', () => ({
  default: () => ({
    uploads: mockGoogleDriveUploads,
    loading: false,
    error: false,
    deleteUpload: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
  }),
}));

vi.mock('./hooks/useActiveShares', () => ({
  useActiveShares: () => [],
}));

type AnalyticsGlobals = {
  hj?: ReturnType<typeof vi.fn>;
  gtag?: ReturnType<typeof vi.fn>;
};

let mockJobs: JobResponse[] = [];
let mockUploads: {
  id: string;
  size_mb: number;
  owner: number;
  key: string;
  filename: string;
  object_id: string;
  created_at: string | null;
  source?: string | null;
}[] = [];
let mockDropboxUploads: {
  id: number;
  bytes: number;
  name: string;
  created_at: string | null;
}[] = [];
let mockGoogleDriveUploads: {
  id: string;
  iconUrl: string;
  mimeType: string;
  name: string;
  sizeBytes: string | null;
  url: string;
  last_converted_at: string | null;
}[] = [];

const buildJob = (overrides: Partial<JobResponse> = {}): JobResponse => ({
  id: 1 as JobsId,
  owner: 'owner-1',
  object_id: 'page-id',
  status: 'started',
  created_at: new Date('2026-05-10T11:30:00Z'),
  last_edited_time: new Date('2026-05-10T11:30:00Z'),
  title: 'Active conversion',
  type: 'page',
  job_reason_failure: null,
  restartable: false,
  download_key: null,
  upload_id: null,
  ...overrides,
});

const renderAt = (path: string) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <DownloadsPage setError={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe('DownloadsPage paywall query param', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockJobs = [buildJob()];
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('shows PaywallBanner when ?paywall=1 is present', () => {
    renderAt('/downloads?paywall=1');
    expect(
      screen.getByText('One conversion at a time on the free plan')
    ).toBeInTheDocument();
  });

  it('does not show PaywallBanner without ?paywall=1', () => {
    renderAt('/downloads');
    expect(
      screen.queryByText('One conversion at a time on the free plan')
    ).not.toBeInTheDocument();
  });

  it('renders PaywallBanner without the in-progress affordance when no active job exists', () => {
    mockJobs = [];
    renderAt('/downloads?paywall=1');
    expect(
      screen.getByText('One conversion at a time on the free plan')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Or wait for/)).not.toBeInTheDocument();
  });
});

describe('DownloadsPage translation safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockJobs = [buildJob()];
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('opts the polling job rows out of browser translation', () => {
    const { container } = renderAt('/downloads');
    expect(container.querySelector('tbody')).toHaveAttribute('translate', 'no');
  });
});

describe('DownloadsPage empty state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockJobs = [];
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('shows empty state when all four sources are empty', () => {
    renderAt('/downloads');
    expect(screen.getByText('No decks yet')).toBeInTheDocument();
  });

  it('hides empty state when doneJobs has entries', () => {
    mockJobs = [buildJob({ status: 'done' })];
    renderAt('/downloads');
    expect(screen.queryByText('No decks yet')).not.toBeInTheDocument();
  });

  it('hides empty state when uploads has entries', () => {
    mockUploads = [
      {
        id: 'u1',
        size_mb: 1,
        owner: 1,
        key: 'k1',
        filename: 'deck.apkg',
        object_id: 'o1',
        created_at: '2026-05-18T10:00:00Z',
      },
    ];
    renderAt('/downloads');
    expect(screen.queryByText('No decks yet')).not.toBeInTheDocument();
  });
});

describe('DownloadsPage chip filters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockUploads = [];
    mockDropboxUploads = [
      {
        id: 10,
        bytes: 1024,
        name: 'notes.html',
        created_at: '2026-05-17T08:00:00Z',
      },
    ];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('chip filter ?filter=in-progress shows only active jobs', () => {
    mockJobs = [
      buildJob({ id: 1 as JobsId, status: 'started', title: 'Active job' }),
      buildJob({ id: 2 as JobsId, status: 'done', title: 'Done job' }),
    ];
    renderAt('/downloads?filter=in-progress');
    expect(screen.getByText('Active job')).toBeInTheDocument();
    expect(screen.queryByText('Done job')).not.toBeInTheDocument();
  });

  it('chip filter ?filter=dropbox shows only Dropbox rows', () => {
    mockJobs = [buildJob({ status: 'done', title: 'Notion deck' })];
    renderAt('/downloads?filter=dropbox');
    expect(screen.getByText('notes.html')).toBeInTheDocument();
    expect(screen.queryByText('Notion deck')).not.toBeInTheDocument();
  });

  it('shows "No decks match this filter." when filter has no results', () => {
    mockJobs = [];
    mockDropboxUploads = [];
    renderAt('/downloads?filter=dropbox');
    expect(screen.getByText('No decks match this filter.')).toBeInTheDocument();
  });
});

describe('DownloadsPage source labels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('shows "Written with Claude" label for claude jobs', () => {
    mockJobs = [
      buildJob({ type: 'claude', status: 'done', title: 'Claude deck' }),
    ];
    renderAt('/downloads');
    expect(screen.getByText('Written with Claude')).toBeInTheDocument();
  });

  it('leads the page subtitle with clean-deck output', () => {
    mockJobs = [];
    renderAt('/downloads');
    expect(
      screen.getByText(
        /Clean decks — proper cloze, atomic cards, no empty backs/i
      )
    ).toBeInTheDocument();
  });

  it('shows "Notion" source label for notion jobs', () => {
    mockJobs = [
      buildJob({ type: 'page', status: 'done', title: 'Notion deck' }),
    ];
    renderAt('/downloads');
    expect(screen.getAllByText('Notion').length).toBeGreaterThan(0);
  });

  it('shows "From the app" source label for uploads saved from the app', () => {
    mockUploads = [
      {
        id: 'u-app',
        size_mb: 2,
        owner: 1,
        key: 'app-deck.apkg',
        filename: 'Pharmacology.apkg',
        object_id: '',
        created_at: '2026-05-18T10:00:00Z',
        source: 'app',
      },
    ];
    renderAt('/downloads');
    expect(screen.getByText('From the app')).toBeInTheDocument();
  });

  it('shows a done MCP deck once, labeled "Made with Claude"', () => {
    mockJobs = [
      buildJob({
        type: 'mcp',
        status: 'done',
        object_id: 'mcp-deck-uuid',
        title: 'Claude connector deck',
        download_key: 'mcp-deck.apkg',
        upload_id: 55,
      }),
    ];
    mockUploads = [
      {
        id: 'u-mcp',
        size_mb: 2,
        owner: 1,
        key: 'mcp-deck.apkg',
        filename: 'Claude connector deck',
        object_id: 'mcp-deck-uuid',
        created_at: '2026-05-18T10:00:00Z',
        source: null,
      },
    ];
    renderAt('/downloads');
    expect(screen.getByText('Made with Claude')).toBeInTheDocument();
    expect(screen.getAllByText('Claude connector deck')).toHaveLength(1);
  });
});

describe('DownloadsPage preview button on done job rows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('renders the preview link when a done job has a .apkg download_key', () => {
    mockJobs = [
      buildJob({
        status: 'done',
        type: 'page',
        title: 'Pharmacology Ch. 4',
        download_key: 'deck-abc123.apkg',
      }),
    ];
    renderAt('/downloads');
    const previewLink = screen.getByLabelText('Preview Pharmacology Ch. 4');
    expect(previewLink).toBeInTheDocument();
    expect(previewLink.getAttribute('href')).toBe(
      '/preview/apkg/deck-abc123.apkg'
    );
  });

  it('does not render the preview link when download_key does not end with .apkg', () => {
    mockJobs = [
      buildJob({
        status: 'done',
        type: 'page',
        title: 'Some deck',
        download_key: 'deck-abc123.zip',
      }),
    ];
    renderAt('/downloads');
    expect(
      screen.queryByLabelText('Preview Some deck')
    ).not.toBeInTheDocument();
  });
});

describe('renderJobStatusCell — URL construction', () => {
  it('uses /api/download/u/<download_key> when download_key is present', () => {
    const job = buildJob({
      status: 'done',
      type: 'page',
      download_key: 'abc123.apkg',
      upload_id: 5,
    });
    const result = renderJobStatusCell(job, i18n.t);
    const { container } = render(<>{result}</>);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/api/download/u/abc123.apkg');
  });

  it('renders no Download action when download_key is null on a done job', () => {
    const job = buildJob({
      status: 'done',
      type: 'page',
      download_key: null,
      upload_id: null,
    });
    const result = renderJobStatusCell(job, i18n.t);
    expect(result).toBeNull();
  });

  it('renders in-progress indicator for non-terminal status', () => {
    const job = buildJob({
      status: 'started',
      download_key: null,
      upload_id: null,
    });
    const result = renderJobStatusCell(job, i18n.t);
    expect(result).not.toBeNull();
  });
});

describe('DownloadsPage deck feedback prompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    localStorage.clear();
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
    mockJobs = [
      buildJob({
        status: 'done',
        type: 'page',
        title: 'Pharmacology Ch. 4',
        download_key: 'deck-abc123.apkg',
      }),
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('hides the feedback prompt until a deck is downloaded', () => {
    renderAt('/downloads');
    expect(
      screen.queryByText('Did this deck come out right?')
    ).not.toBeInTheDocument();
  });

  it('shows the feedback prompt after clicking a download link', () => {
    renderAt('/downloads');
    fireEvent.click(screen.getByLabelText('Download Pharmacology Ch. 4'));
    expect(
      screen.getByText('Did this deck come out right?')
    ).toBeInTheDocument();
  });

  it('keeps the feedback prompt hidden after download when suppressed', () => {
    localStorage.setItem(
      '2anki_deck_feedback_suppressed_until',
      String(Date.now() + 60_000)
    );
    renderAt('/downloads');
    fireEvent.click(screen.getByLabelText('Download Pharmacology Ch. 4'));
    expect(
      screen.queryByText('Did this deck come out right?')
    ).not.toBeInTheDocument();
  });
});

describe('DownloadsPage failure reason panel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('expands failure reason panel when clicking failed status tag', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        title: 'Failed deck',
        job_reason_failure:
          'Your page title has a "/" in it, which we can\'t save as a filename. Rename the page in Notion (try a dash or "and") and convert again.',
      }),
    ];
    renderAt('/downloads');

    const statusButton = screen.getByRole('button', {
      name: /Show failure reason/i,
    });
    fireEvent.click(statusButton);

    expect(
      screen.getByText(/Your page title has a "\/" in it/)
    ).toBeInTheDocument();
  });

  it('collapses panel when clicking chevron again', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        job_reason_failure:
          'Your page title has a "/" in it, which we can\'t save as a filename. Rename the page in Notion (try a dash or "and") and convert again.',
      }),
    ];
    renderAt('/downloads');

    const statusButton = screen.getByRole('button', {
      name: /Show failure reason/i,
    });
    fireEvent.click(statusButton);
    expect(
      screen.getByText(/Your page title has a "\/" in it/)
    ).toBeInTheDocument();

    const collapseButton = screen.getByRole('button', {
      name: /Collapse failure reason/i,
    });
    fireEvent.click(collapseButton);
    expect(
      screen.queryByText(/Your page title has a "\/" in it/)
    ).not.toBeInTheDocument();
  });

  it('auto-expands most recent failed job if last_edited_time is within 10 minutes', () => {
    mockJobs = [
      buildJob({
        id: 1 as JobsId,
        status: 'failed',
        last_edited_time: new Date('2026-05-19T11:55:00Z'),
        job_reason_failure:
          'Your page title has a "/" in it, which we can\'t save as a filename. Rename the page in Notion (try a dash or "and") and convert again.',
      }),
    ];
    renderAt('/downloads');

    expect(
      screen.getByText(/Your page title has a "\/" in it/)
    ).toBeInTheDocument();
  });

  it('does not auto-expand if last_edited_time is older than 10 minutes', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        last_edited_time: new Date('2026-05-19T11:45:00Z'),
        job_reason_failure:
          'Your page title has a "/" in it, which we can\'t save as a filename. Rename the page in Notion (try a dash or "and") and convert again.',
      }),
    ];
    renderAt('/downloads');

    expect(
      screen.queryByText(/Your page title has a "\/" in it/)
    ).not.toBeInTheDocument();
  });

  it('shows the toggle teaching copy and docs CTA for empty deck errors without a click', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        job_reason_failure:
          "No cards in this deck yet. 2anki makes a card from every Notion toggle — the toggle title becomes the question, what's inside becomes the answer. Wrap your key terms in toggles, then convert again.",
      }),
    ];
    renderAt('/downloads');

    expect(
      screen.getByText(/makes a card from every Notion toggle/i)
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', {
      name: 'See how toggles become cards',
    });
    expect(cta).toHaveAttribute('href', '/documentation/cards/notion-blocks');
  });

  it('does not render a show/collapse toggle for empty deck errors', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        job_reason_failure:
          "No cards in this deck yet. 2anki makes a card from every Notion toggle — the toggle title becomes the question, what's inside becomes the answer. Wrap your key terms in toggles, then convert again.",
      }),
    ];
    renderAt('/downloads');

    expect(
      screen.queryByRole('button', { name: /Show failure reason/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Collapse failure reason/i })
    ).not.toBeInTheDocument();
  });

  it('does not show the toggles docs CTA for non-empty-deck errors', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        job_reason_failure:
          'Your page title has a "/" in it, which we can\'t save as a filename. Rename the page in Notion (try a dash or "and") and convert again.',
      }),
    ];
    renderAt('/downloads');

    const statusButton = screen.getByRole('button', {
      name: /Show failure reason/i,
    });
    fireEvent.click(statusButton);

    expect(
      screen.queryByRole('link', { name: 'See how toggles become cards' })
    ).not.toBeInTheDocument();
  });
});

describe('DownloadsPage monthly limit panel', () => {
  const monthlyLimitReason = JSON.stringify({
    code: 'monthly_limit',
    cards_used: 56,
    limit: 100,
    reset_on: '2026-07-01T00:00:00.000Z',
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
    mockJobs = [
      buildJob({
        status: 'failed',
        title: 'Big deck',
        last_edited_time: new Date('2026-06-10T11:30:00Z'),
        created_at: new Date('2026-06-10T11:30:00Z'),
        job_reason_failure: monthlyLimitReason,
      }),
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('auto-expands the paywall panel inline on load without any click', () => {
    renderAt('/downloads');
    expect(
      screen.getByText("You've used 56 of your 100 free cards this month")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your free cards refresh on 1 July 2026/)
    ).toBeInTheDocument();
  });

  it('labels the collapsed chip neutrally instead of the red failed tag', () => {
    renderAt('/downloads');
    expect(screen.getByText('Monthly limit reached')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /monthly limit details/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Show failure reason/i })
    ).not.toBeInTheDocument();
  });

  it('leads the panel with the Day Pass primary CTA', () => {
    renderAt('/downloads');
    expect(
      screen.getByRole('button', { name: 'Get Day Pass — $4' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Week Pass — $9' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Upgrade to Unlimited' })
    ).toBeInTheDocument();
  });

  it('stays collapsed after the user closes the panel', () => {
    renderAt('/downloads');
    fireEvent.click(
      screen.getByRole('button', { name: /Collapse monthly limit details/i })
    );
    expect(
      screen.queryByText("You've used 56 of your 100 free cards this month")
    ).not.toBeInTheDocument();
  });
});

describe('DownloadsPage notion_token_expired failure panel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('shows reconnect CTA for a Notion job with notion_token_expired reason', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        type: 'page',
        last_edited_time: new Date('2026-05-25T11:55:00Z'),
        job_reason_failure: 'notion_token_expired',
      }),
    ];
    renderAt('/downloads');

    expect(
      screen.getByText(
        'Notion connection expired. Reconnect to keep converting pages.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Reconnect Notion' })
    ).toHaveAttribute('href', '/notion');
  });

  it('does not show a restart button for notion_token_expired failure', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        type: 'page',
        restartable: true,
        last_edited_time: new Date('2026-05-25T11:55:00Z'),
        job_reason_failure: 'notion_token_expired',
      }),
    ];
    renderAt('/downloads');

    expect(
      screen.queryByRole('button', { name: /Restart job/i })
    ).not.toBeInTheDocument();
  });

  it('does not show reconnect CTA for a file-upload job with notion_token_expired reason', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        type: 'claude',
        last_edited_time: new Date('2026-05-25T11:55:00Z'),
        job_reason_failure: 'notion_token_expired',
      }),
    ];
    renderAt('/downloads');

    expect(
      screen.queryByRole('link', { name: 'Reconnect Notion' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Notion connection expired. Reconnect to keep converting pages.'
      )
    ).not.toBeInTheDocument();
  });

  it('does not show reconnect CTA for a Notion job with a generic failure reason', () => {
    mockJobs = [
      buildJob({
        status: 'failed',
        type: 'page',
        last_edited_time: new Date('2026-05-25T11:45:00Z'),
        job_reason_failure: 'Something went wrong on our end.',
      }),
    ];
    renderAt('/downloads');

    const statusButton = screen.getByRole('button', {
      name: /Show failure reason/i,
    });
    fireEvent.click(statusButton);

    expect(
      screen.queryByRole('link', { name: 'Reconnect Notion' })
    ).not.toBeInTheDocument();
  });
});

describe('DownloadsPage cancel_during_generating telemetry', () => {
  let fetchCalls: { url: string; body: Record<string, unknown> }[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T10:00:00Z'));
    fetchCalls = [];
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (typeof url === 'string') {
          try {
            fetchCalls.push({
              url,
              body: JSON.parse((init?.body as string) ?? '{}'),
            });
          } catch {
            /* ignore */
          }
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      });
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('fires cancel_during_generating when cancel is clicked on a step2_creating_flashcards job', () => {
    mockJobs = [
      buildJob({
        id: 42 as JobsId,
        status: 'step2_creating_flashcards',
        title: 'PDF notes',
      }),
    ];
    renderAt('/downloads');

    const cancelButton = screen.getByRole('button', {
      name: /Cancel PDF notes/i,
    });
    fireEvent.click(cancelButton);

    const analyticsCall = fetchCalls.find(
      (c) =>
        c.url === '/api/events/track' &&
        c.body?.name === 'cancel_during_generating'
    );
    expect(analyticsCall).toBeDefined();
  });

  it('does not fire cancel_during_generating when cancel is clicked on a done job', () => {
    mockJobs = [
      buildJob({
        id: 43 as JobsId,
        status: 'done',
        title: 'Done deck',
        download_key: 'deck.apkg',
      }),
    ];
    renderAt('/downloads');

    const deleteButton = screen.getByRole('button', {
      name: /Delete Done deck/i,
    });
    fireEvent.click(deleteButton);

    const analyticsCall = fetchCalls.find(
      (c) =>
        c.url === '/api/events/track' &&
        c.body?.name === 'cancel_during_generating'
    );
    expect(analyticsCall).toBeUndefined();
  });
});

describe('DownloadsPage make another deck CTA', () => {
  let fetchCalls: { url: string; body: Record<string, unknown> }[] = [];

  function LocationDisplay() {
    const location = useLocation();
    return <div data-testid="location-display">{location.pathname}</div>;
  }

  const renderWithLocation = () =>
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/downloads']}>
          <Routes>
            <Route
              path="/downloads"
              element={<DownloadsPage setError={vi.fn()} />}
            />
            <Route path="/upload" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
    fetchCalls = [];
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (typeof url === 'string') {
          try {
            fetchCalls.push({
              url,
              body: JSON.parse((init?.body as string) ?? '{}'),
            });
          } catch {
            /* ignore */
          }
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      });
    localStorage.clear();
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
    mockJobs = [
      buildJob({
        status: 'done',
        type: 'page',
        title: 'Pharmacology Ch. 4',
        download_key: 'deck-abc123.apkg',
      }),
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('hides the CTA until a deck is downloaded', () => {
    renderWithLocation();
    expect(
      screen.queryByRole('button', { name: 'Make another deck' })
    ).not.toBeInTheDocument();
  });

  it('shows the CTA after a deck download fires', () => {
    renderWithLocation();
    fireEvent.click(screen.getByLabelText('Download Pharmacology Ch. 4'));
    expect(
      screen.getByRole('button', { name: 'Make another deck' })
    ).toBeInTheDocument();
  });

  it('fires make_another_deck_clicked and navigates to /upload on click', () => {
    const gtag = (globalThis as AnalyticsGlobals).gtag!;
    renderWithLocation();
    fireEvent.click(screen.getByLabelText('Download Pharmacology Ch. 4'));
    fireEvent.click(screen.getByRole('button', { name: 'Make another deck' }));

    expect(gtag).toHaveBeenCalledWith('event', 'make_another_deck_clicked');
    const trackCall = fetchCalls.find(
      (c) =>
        c.url === '/api/events/track' &&
        c.body?.name === 'make_another_deck_clicked'
    );
    expect(trackCall).toBeDefined();
    expect(screen.getByTestId('location-display').textContent).toBe('/upload');
  });
});

describe('DownloadsPage view telemetry', () => {
  let fetchCalls: { url: string; body: Record<string, unknown> }[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    fetchCalls = [];
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (typeof url === 'string') {
          try {
            fetchCalls.push({
              url,
              body: JSON.parse((init?.body as string) ?? '{}'),
            });
          } catch {
            /* ignore */
          }
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      });
    mockJobs = [buildJob({ status: 'done', download_key: 'deck.apkg' })];
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  const downloadsPageViewedCalls = () =>
    fetchCalls.filter(
      (c) =>
        c.url === '/api/events/track' &&
        c.body?.name === 'downloads_page_viewed'
    );

  it('fires downloads_page_viewed once on mount', () => {
    renderAt('/downloads');
    expect(downloadsPageViewedCalls()).toHaveLength(1);
  });

  it('fires downloads_page_viewed only once across a re-render', () => {
    const { rerender } = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/downloads']}>
          <DownloadsPage setError={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/downloads']}>
          <DownloadsPage setError={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(downloadsPageViewedCalls()).toHaveLength(1);
  });
});

describe('DownloadsPage truncation notice', () => {
  const truncatedJob = (subDeckRulesSkipped: boolean) =>
    buildJob({
      status: 'done',
      type: 'page',
      title: 'Long Notion Page',
      download_key: 'deck-long.apkg',
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 100,
        sub_deck_rules_skipped: subDeckRulesSkipped,
      }),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockJobs = [truncatedJob(false)];
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('shows a Partial toggle on a truncated done Notion row', () => {
    renderAt('/downloads');
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(
      screen.queryByText(/Converted the first 100 blocks/)
    ).not.toBeInTheDocument();
  });

  it('expands the truncation note with the upgrade link on toggle', () => {
    renderAt('/downloads');
    fireEvent.click(
      screen.getByRole('button', { name: 'Show conversion note' })
    );
    expect(
      screen.getByText(
        /Converted the first 100 blocks\. The free plan stops there/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'upgrade to convert the whole page' })
    ).toHaveAttribute('href', '/pricing?source=truncated-conversion');
    expect(
      screen.queryByText(/Sub-deck rules from toggles/)
    ).not.toBeInTheDocument();
  });

  it('adds the sub-deck rules line when they were skipped', () => {
    mockJobs = [truncatedJob(true)];
    renderAt('/downloads');
    fireEvent.click(
      screen.getByRole('button', { name: 'Show conversion note' })
    );
    expect(
      screen.getByText(
        /Sub-deck rules from toggles, headings, and databases apply on paid plans/
      )
    ).toBeInTheDocument();
  });

  it('shows no toggle on a done Notion row without truncation', () => {
    mockJobs = [
      buildJob({
        status: 'done',
        type: 'page',
        title: 'Short Page',
        download_key: 'deck-short.apkg',
      }),
    ];
    renderAt('/downloads');
    expect(screen.queryByText('Partial')).not.toBeInTheDocument();
  });
});

describe('DownloadsPage conversion note toggles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    mockUploads = [];
    mockDropboxUploads = [];
    mockGoogleDriveUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  const doneNotionJob = (
    payload: unknown,
    overrides: Partial<JobResponse> = {}
  ) =>
    buildJob({
      status: 'done',
      type: 'page',
      title: 'Notion deck',
      download_key: 'deck.apkg',
      job_reason_failure: JSON.stringify(payload),
      ...overrides,
    });

  it('reveals the unshared-blocks notice from its own badge', () => {
    mockJobs = [
      doneNotionJob({ code: 'notion_blocks_forbidden', forbidden_blocks: 3 }),
    ];
    renderAt('/downloads');

    expect(
      screen.queryByText(/isn't connected to 2anki/)
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: '3 parts not connected' })
    );
    expect(screen.getByText(/3 parts of this page/)).toBeInTheDocument();
  });

  it('counts a single unshared block with the singular badge', () => {
    mockJobs = [
      doneNotionJob({ code: 'notion_blocks_forbidden', forbidden_blocks: 1 }),
    ];
    renderAt('/downloads');
    expect(screen.getByText('1 part not connected')).toBeInTheDocument();
  });

  it('reveals the structure-rescued notice from its own badge', () => {
    mockJobs = [
      doneNotionJob({ code: 'notion_structure_rescued', rule: 'heading' }),
    ];
    renderAt('/downloads');

    fireEvent.click(screen.getByRole('button', { name: 'Structure guessed' }));
    expect(screen.getByText(/Cards built from the/)).toBeInTheDocument();
  });

  it('reveals the columns-guessed notice from its own badge', () => {
    mockJobs = [
      doneNotionJob(
        {
          code: 'notion_columns_guessed',
          front_field: 'Term',
          back_field: 'Definition',
        },
        { type: 'database' }
      ),
    ];
    renderAt('/downloads');

    fireEvent.click(screen.getByRole('button', { name: 'Columns guessed' }));
    expect(screen.getByText(/couldn't tell which columns/)).toBeInTheDocument();
  });

  it('reveals the unsupported-blocks notice from its own badge', () => {
    mockJobs = [
      doneNotionJob({
        code: 'notion_unsupported_blocks',
        unsupported_blocks: { pdf: 2 },
      }),
    ];
    renderAt('/downloads');

    fireEvent.click(screen.getByRole('button', { name: '2 blocks skipped' }));
    expect(screen.getByText(/couldn't be converted/)).toBeInTheDocument();
  });

  it('shows one badge per signal when several ride along on one conversion', () => {
    mockJobs = [
      doneNotionJob({
        code: 'notion_blocks_forbidden',
        forbidden_blocks: 2,
        dropped_assets: 1,
        unsupported_blocks: { pdf: 4 },
      }),
    ];
    renderAt('/downloads');

    expect(screen.getByText('2 parts not connected')).toBeInTheDocument();
    expect(screen.getByText('1 image skipped')).toBeInTheDocument();
    expect(screen.getByText('4 blocks skipped')).toBeInTheDocument();
  });

  it('shows no conversion-note badge on a clean database conversion', () => {
    mockJobs = [
      doneNotionJob(
        { code: 'notion_database_resolved', via_page_link_selfheal: false },
        { type: 'database' }
      ),
    ];
    renderAt('/downloads');

    expect(
      screen.queryByRole('button', { name: /not connected/ })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /blocks skipped/ })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Structure guessed/ })
    ).not.toBeInTheDocument();
  });

  it('points each badge at the notice panel it reveals', () => {
    mockJobs = [
      doneNotionJob({ code: 'notion_blocks_forbidden', forbidden_blocks: 3 }),
    ];
    renderAt('/downloads');

    const toggle = screen.getByRole('button', {
      name: '3 parts not connected',
    });
    expect(toggle).toHaveAttribute('aria-controls', 'job-1-forbiddenblocks');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      document.getElementById('job-1-forbiddenblocks')
    ).toBeInTheDocument();
  });

  it('shows no conversion-note badge on a failed job', () => {
    mockJobs = [
      doneNotionJob(
        { code: 'notion_blocks_forbidden', forbidden_blocks: 3 },
        { status: 'failed' }
      ),
    ];
    renderAt('/downloads');

    expect(
      screen.queryByRole('button', { name: /not connected/ })
    ).not.toBeInTheDocument();
  });
});

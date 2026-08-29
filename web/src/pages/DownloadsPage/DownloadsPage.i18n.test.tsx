import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../lib/i18n';
import { DownloadsPage } from './DownloadsPage';
import JobResponse from '../../schemas/public/JobResponse';
import { JobsId } from '../../schemas/public/Jobs';

let mockJobs: JobResponse[] = [];

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
    uploads: [],
    loading: false,
    error: null,
    deleteUpload: vi.fn(),
    refreshUploads: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./hooks/useDropboxUploads', () => ({
  default: () => ({ uploads: [], deleteUpload: vi.fn() }),
}));

vi.mock('./hooks/useGoogleDriveUploads', () => ({
  default: () => ({ uploads: [], deleteUpload: vi.fn() }),
}));

vi.mock('./hooks/useActiveShares', () => ({
  useActiveShares: () => [],
}));

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({}),
}));

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: { locals: { patreon: false, subscriber: false } },
  }),
}));

const buildJob = (overrides: Partial<JobResponse> = {}): JobResponse => ({
  id: 1 as JobsId,
  owner: 'owner-1',
  object_id: 'page-id',
  status: 'done',
  created_at: new Date('2026-05-10T11:30:00Z'),
  last_edited_time: new Date('2026-05-10T11:30:00Z'),
  title: 'Pharmacology Ch. 4',
  type: 'page',
  job_reason_failure: null,
  card_count: null,
  restartable: false,
  download_key: 'deck.apkg',
  upload_id: null,
  empty_back_count: 0,
  ...overrides,
});

function renderPage() {
  return render(
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
}

describe('DownloadsPage in German', () => {
  beforeEach(async () => {
    mockJobs = [buildJob()];
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the page header and subtitle', () => {
    renderPage();
    expect(screen.getByText('Meine Stapel')).toBeInTheDocument();
    expect(screen.getByText(/Lade sie direkt in Anki/i)).toBeInTheDocument();
  });

  it('translates the filter chips and table columns', () => {
    renderPage();
    expect(screen.getByText('Alle')).toBeInTheDocument();
    expect(screen.getByText('In Arbeit')).toBeInTheDocument();
    expect(screen.getByText('Quelle')).toBeInTheDocument();
    expect(screen.getByText('Aktionen')).toBeInTheDocument();
  });
});

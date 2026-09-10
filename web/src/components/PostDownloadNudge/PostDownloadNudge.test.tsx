import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/hooks/useUserLocals', () => ({ useUserLocals: vi.fn() }));
vi.mock('../../lib/hooks/useCardUsage', () => ({ useCardUsage: vi.fn() }));
vi.mock('../../lib/backend/get2ankiApi', () => ({ get2ankiApi: vi.fn() }));

import { track } from '../../lib/analytics/track';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { useCardUsage } from '../../lib/hooks/useCardUsage';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { PostDownloadNudge } from './PostDownloadNudge';

const trackMock = track as ReturnType<typeof vi.fn>;
const useUserLocalsMock = useUserLocals as ReturnType<typeof vi.fn>;
const useCardUsageMock = useCardUsage as ReturnType<typeof vi.fn>;
const get2ankiApiMock = get2ankiApi as ReturnType<typeof vi.fn>;

const freeUser = {
  data: {
    user: { email: 'free@example.com' },
    locals: { subscriber: false, patreon: false },
  },
};

function mockApi(overrides: Record<string, unknown> = {}) {
  const api = {
    getPitchEligibility: vi.fn().mockResolvedValue({
      convertSuccess: false,
      accountBanner: false,
      producerPrompt: false,
      postDownloadNudge: true,
    }),
    dismissPitch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  get2ankiApiMock.mockReturnValue(api);
  return api;
}

const renderNudge = (page: 'upload' | 'downloads' = 'upload') =>
  render(
    <MemoryRouter>
      <PostDownloadNudge page={page} />
    </MemoryRouter>
  );

describe('PostDownloadNudge', () => {
  beforeEach(() => {
    trackMock.mockReset();
    useUserLocalsMock.mockReturnValue(freeUser);
    useCardUsageMock.mockReturnValue({
      loading: false,
      cards_limit: 100,
      cards_used: 12,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('renders for an eligible free user and fires paywall_shown once', async () => {
    mockApi();
    renderNudge();

    await waitFor(() => {
      expect(screen.getByText('Enjoying 2anki?')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/pricing?source=post_download_nudge'
    );
    await waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(trackMock).toHaveBeenCalledWith('paywall_shown', {
      surface: 'post_download_nudge',
      page: 'upload',
    });
  });

  test('dismiss hides the card, persists, and fires paywall_dismissed', async () => {
    const api = mockApi();
    renderNudge('downloads');

    await waitFor(() => {
      expect(screen.getByText('Enjoying 2anki?')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Enjoying 2anki?')).not.toBeInTheDocument();
    expect(api.dismissPitch).toHaveBeenCalledWith('post_download_nudge');
    expect(trackMock).toHaveBeenCalledWith('paywall_dismissed', {
      surface: 'post_download_nudge',
      page: 'downloads',
    });
  });

  test('CTA click fires paywall_upgrade_clicked', async () => {
    mockApi();
    renderNudge();

    await waitFor(() => {
      expect(screen.getByText('Enjoying 2anki?')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('link', { name: 'See plans' }));

    expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'post_download_nudge',
      page: 'upload',
      plan: 'see_plans',
    });
  });

  test('renders nothing for a paying user and never calls eligibility', async () => {
    const api = mockApi();
    useUserLocalsMock.mockReturnValue({
      data: {
        user: { email: 'pro@example.com' },
        locals: { subscriber: true, patreon: false },
      },
    });
    const { container } = renderNudge();

    expect(container).toBeEmptyDOMElement();
    expect(api.getPitchEligibility).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  test('renders nothing for an anonymous user', () => {
    mockApi();
    useUserLocalsMock.mockReturnValue({
      data: { user: { email: null }, locals: {} },
    });
    const { container } = renderNudge();

    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when the nudge was dismissed server-side', async () => {
    mockApi({
      getPitchEligibility: vi.fn().mockResolvedValue({
        convertSuccess: false,
        accountBanner: false,
        producerPrompt: false,
        postDownloadNudge: false,
      }),
    });
    const { container } = renderNudge();

    await waitFor(() => {
      expect(get2ankiApiMock).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
    expect(trackMock).not.toHaveBeenCalled();
  });

  test('shows the real card limit in the body', async () => {
    mockApi();
    useCardUsageMock.mockReturnValue({
      loading: false,
      cards_limit: 100,
      cards_used: 0,
    });
    renderNudge();

    await waitFor(() => {
      expect(screen.getByText(/100 cards a month/)).toBeInTheDocument();
    });
  });
});

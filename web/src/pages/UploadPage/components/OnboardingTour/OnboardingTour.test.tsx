import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const markOnboardedMock = vi.fn(async () => {});

vi.mock('../../../../lib/backend/markOnboarded', () => ({
  markOnboarded: () => markOnboardedMock(),
}));

const trackMock = vi.fn();

vi.mock('../../../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

import { OnboardingTour } from './OnboardingTour';

const MIGRATION_DATE = '2026-06-08T00:00:00.000Z';
const AFTER_MIGRATION = '2026-06-09T12:00:00.000Z';
const BEFORE_MIGRATION = '2026-06-07T12:00:00.000Z';

describe('OnboardingTour', () => {
  beforeEach(() => {
    markOnboardedMock.mockClear();
    trackMock.mockClear();
  });

  it('renders the tour for a new user with no onboarded_at', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    expect(
      screen.getByText('Drop a file, or pick a Notion page.')
    ).toBeInTheDocument();
  });

  it('does not render the tour for a user who has already been onboarded', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt="2026-06-09T13:00:00.000Z"
        migrationDate={MIGRATION_DATE}
      />
    );
    expect(
      screen.queryByText('Drop a file, or pick a Notion page.')
    ).not.toBeInTheDocument();
  });

  it('does not render the tour for users created before the migration date', () => {
    render(
      <OnboardingTour
        createdAt={BEFORE_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    expect(
      screen.queryByText('Drop a file, or pick a Notion page.')
    ).not.toBeInTheDocument();
  });

  it('does not render the tour when createdAt is null (unauthenticated)', () => {
    render(
      <OnboardingTour
        createdAt={null}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    expect(
      screen.queryByText('Drop a file, or pick a Notion page.')
    ).not.toBeInTheDocument();
  });

  it('advances through all four steps with Next', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    expect(
      screen.getByText('Drop a file, or pick a Notion page.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Pick deck settings.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByText('Convert your file into a deck.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByText('Download the deck, or send it to AnkiWeb.')
    ).toBeInTheDocument();
  });

  it('goes back one step with Back', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Pick deck settings.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByText('Drop a file, or pick a Notion page.')
    ).toBeInTheDocument();
  });

  it('skipping calls markOnboarded and hides the tour', async () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Drop a file, or pick a Notion page.')
      ).not.toBeInTheDocument()
    );
    expect(markOnboardedMock).toHaveBeenCalledTimes(1);
  });

  it('does not show Back on the first step', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Back' })
    ).not.toBeInTheDocument();
  });

  it('does not show Next on the last step', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.queryByRole('button', { name: 'Next' })
    ).not.toBeInTheDocument();
  });

  it('completing the last step via Skip calls markOnboarded and hides the tour', async () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Download the deck, or send it to AnkiWeb.')
      ).not.toBeInTheDocument()
    );
    expect(markOnboardedMock).toHaveBeenCalledTimes(1);
  });

  it('tracks onboarding_shown once when the tour first renders', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    const shownCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'onboarding_shown'
    );
    expect(shownCalls).toHaveLength(1);
  });

  it('does not track onboarding_shown when the tour is hidden', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt="2026-06-09T13:00:00.000Z"
        migrationDate={MIGRATION_DATE}
      />
    );
    expect(trackMock).not.toHaveBeenCalledWith('onboarding_shown');
  });

  it('tracks onboarding_skipped when Skip is pressed before the last step', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(trackMock).toHaveBeenCalledWith('onboarding_skipped');
    expect(trackMock).not.toHaveBeenCalledWith('onboarding_completed');
  });

  it('exposes a dialog and moves focus into it when it opens', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  });

  it('dismisses the tour on Escape and calls markOnboarded', async () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByText('Drop a file, or pick a Notion page.')
      ).not.toBeInTheDocument()
    );
    expect(markOnboardedMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('onboarding_skipped');
  });

  it('tracks onboarding_completed when Skip is pressed on the last step', () => {
    render(
      <OnboardingTour
        createdAt={AFTER_MIGRATION}
        onboardedAt={null}
        migrationDate={MIGRATION_DATE}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(trackMock).toHaveBeenCalledWith('onboarding_completed');
    expect(trackMock).not.toHaveBeenCalledWith('onboarding_skipped');
  });
});

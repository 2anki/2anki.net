import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PauseCard } from './PauseCard';

describe('PauseCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables the pause button until a length is chosen', () => {
    render(
      <PauseCard
        planLabel="$7.99 / month"
        isLegacyRate={false}
        isPausing={false}
        pauseError=""
        onPause={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Pause subscription' })
    ).toBeDisabled();
  });

  it('shows the resume preview and enables pausing once a length is picked', () => {
    const onPause = vi.fn();
    render(
      <PauseCard
        planLabel="$7.99 / month"
        isLegacyRate={false}
        isPausing={false}
        pauseError=""
        onPause={onPause}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '2 months' }));

    expect(screen.getByText(/Resumes .* at \$7\.99 \/ month/)).toBeTruthy();

    const pauseButton = screen.getByRole('button', {
      name: 'Pause subscription',
    });
    expect(pauseButton).not.toBeDisabled();

    fireEvent.click(pauseButton);
    expect(onPause).toHaveBeenCalledWith(2);
  });

  it('renders the error when pausing fails', () => {
    render(
      <PauseCard
        planLabel={null}
        isLegacyRate={false}
        isPausing={false}
        pauseError="Annual plans cannot be paused."
        onPause={vi.fn()}
      />
    );

    expect(screen.getByText('Annual plans cannot be paused.')).toBeTruthy();
  });

  it('names the kept legacy rate when the sub is on a legacy price', () => {
    render(
      <PauseCard
        planLabel="$2 / month"
        isLegacyRate
        isPausing={false}
        pauseError=""
        onPause={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'Pausing keeps your legacy $2 / month rate. Cancelling gives it up.'
      )
    ).toBeInTheDocument();
  });

  it('omits the legacy line for a standard-rate sub', () => {
    render(
      <PauseCard
        planLabel="$7.99 / month"
        isLegacyRate={false}
        isPausing={false}
        pauseError=""
        onPause={vi.fn()}
      />
    );

    expect(screen.queryByText(/Pausing keeps your legacy/)).toBeNull();
  });

  it('marks the resume preview as a live status region', () => {
    render(
      <PauseCard
        planLabel="$7.99 / month"
        isLegacyRate={false}
        isPausing={false}
        pauseError=""
        onPause={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '2 months' }));

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/Resumes .* at \$7\.99 \/ month/);
  });
});

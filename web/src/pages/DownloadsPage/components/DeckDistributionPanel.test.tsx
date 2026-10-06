import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordDeckDistributionIntent = vi.fn();

vi.mock('../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ recordDeckDistributionIntent }),
}));

import { DeckDistributionPanel } from './DeckDistributionPanel';

beforeEach(() => {
  recordDeckDistributionIntent.mockReset();
  recordDeckDistributionIntent.mockResolvedValue(undefined);
});

describe('DeckDistributionPanel', () => {
  it('shows the fake-door prompt and all five answers', () => {
    render(<DeckDistributionPanel uploadKey="deck-1.apkg" />);
    expect(
      screen.getByText("Deck distribution isn't built yet")
    ).toBeInTheDocument();
    expect(
      screen.getByText('Who would you share this deck with?')
    ).toBeInTheDocument();
    for (const name of [
      'Students',
      'Customers',
      'Study group',
      'Colleagues',
      'Just me',
    ]) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('keeps submit disabled until an answer is chosen', () => {
    render(<DeckDistributionPanel uploadKey="deck-1.apkg" />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Students' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('records the chosen answer and upload key, then shows the thank-you', async () => {
    render(<DeckDistributionPanel uploadKey="deck-1.apkg" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Study group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(recordDeckDistributionIntent).toHaveBeenCalledWith(
        'study_group',
        'deck-1.apkg',
        undefined
      );
    });
    expect(await screen.findByText('Noted')).toBeInTheDocument();
    expect(
      screen.getByText("We'll use this to decide what to build.")
    ).toBeInTheDocument();
  });

  it('prefills and sends the signed-in email', async () => {
    render(
      <DeckDistributionPanel
        uploadKey="deck-1.apkg"
        defaultEmail="learner@example.com"
      />
    );
    expect(screen.getByLabelText("Notify me when it's ready")).toHaveValue(
      'learner@example.com'
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Customers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(recordDeckDistributionIntent).toHaveBeenCalledWith(
        'customers',
        'deck-1.apkg',
        'learner@example.com'
      );
    });
  });

  it('blocks submit and warns when the email is malformed', () => {
    render(<DeckDistributionPanel uploadKey="deck-1.apkg" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Just me' }));
    fireEvent.change(screen.getByLabelText("Notify me when it's ready"), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      screen.getByText('Enter a valid email address.')
    ).toBeInTheDocument();
    expect(recordDeckDistributionIntent).not.toHaveBeenCalled();
  });

  it('offers a retry when recording fails', async () => {
    recordDeckDistributionIntent.mockRejectedValueOnce(new Error('network'));
    render(<DeckDistributionPanel uploadKey="deck-1.apkg" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Colleagues' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText("Couldn't send that.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(recordDeckDistributionIntent).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Noted')).toBeInTheDocument();
  });
});

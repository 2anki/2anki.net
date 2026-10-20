import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../lib/i18n';
import { DeckFeedbackPrompt } from './DeckFeedbackPrompt';

vi.mock('../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ submitEmojiFeedback: vi.fn() }),
}));

vi.mock('../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({ data: { locals: {}, user: null } }),
}));

describe('DeckFeedbackPrompt in German', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the prompt and actions in German', () => {
    render(<DeckFeedbackPrompt />);
    expect(
      screen.getByText('Ist dieser Stapel richtig geworden?')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ja, hat funktioniert' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Etwas stimmte nicht' })
    ).toBeInTheDocument();
  });

  it('translates the aria labels', () => {
    render(<DeckFeedbackPrompt />);
    expect(
      screen.getByRole('complementary', { name: 'Stapel-Feedback' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Schließen' })
    ).toBeInTheDocument();
  });
});

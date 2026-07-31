import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../lib/i18n';
import { FeedbackWidget } from './FeedbackWidget';

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ submitEmojiFeedback: vi.fn() }),
}));

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
  }),
}));

describe('FeedbackWidget in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the prompt and rating labels', () => {
    render(<FeedbackWidget page="about" />);
    expect(screen.getByText('Wie ist deine Erfahrung?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wütend' })).toBeInTheDocument();
  });
});

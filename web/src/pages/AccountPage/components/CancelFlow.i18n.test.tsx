import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../lib/i18n';
import { CancelFlow } from './CancelFlow';

describe('CancelFlow in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates reasons and the comment box but keeps the English reason value', () => {
    const onCancel = vi.fn();
    render(
      <CancelFlow
        planLabel={null}
        tenureDays={10}
        pauseEligible={false}
        isCancelling={false}
        isPausing={false}
        pauseError=""
        onCancel={onCancel}
        onKeep={vi.fn()}
        onPause={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('Technische Probleme'));
    expect(
      screen.getByPlaceholderText('Was hat nicht funktioniert? (optional)')
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'kaputt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Abo kündigen' }));

    expect(onCancel).toHaveBeenCalledWith('Technical issues', 'kaputt');
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { ContactPage } from './ContactPage';

const contactUs = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ contactUs }),
}));

function fillVisibleFields() {
  fireEvent.change(
    document.getElementById('contact-name') as HTMLInputElement,
    {
      target: { value: 'A Human' },
    }
  );
  fireEvent.change(
    document.getElementById('contact-email') as HTMLInputElement,
    { target: { value: 'human@example.com' } }
  );
  fireEvent.change(
    document.getElementById('contact-message') as HTMLTextAreaElement,
    { target: { value: 'My deck came back empty.' } }
  );
}

describe('ContactPage honeypot', () => {
  it('hides the bait field from assistive tech and keyboard', () => {
    render(<ContactPage />);
    const field = document.getElementById(
      'contact-website'
    ) as HTMLInputElement;

    expect(field).not.toBeNull();
    expect(field.tabIndex).toBe(-1);
    expect(field.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Website' })).toBeNull();
  });

  it('submits an empty honeypot value for a human', async () => {
    render(<ContactPage />);
    fillVisibleFields();

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(contactUs).toHaveBeenCalledWith(
        'A Human',
        'human@example.com',
        'My deck came back empty.',
        [],
        ''
      )
    );
  });

  it('forwards whatever a bot typed into the bait field', async () => {
    render(<ContactPage />);
    fillVisibleFields();
    fireEvent.change(
      document.getElementById('contact-website') as HTMLInputElement,
      { target: { value: 'https://spam.example.ru' } }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(contactUs).toHaveBeenCalledWith(
        'A Human',
        'human@example.com',
        'My deck came back empty.',
        [],
        'https://spam.example.ru'
      )
    );
  });
});

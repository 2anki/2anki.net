import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LoggedInSuccess } from './LoggedInSuccess';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderComponent(firstName?: string) {
  return render(
    <MemoryRouter>
      <LoggedInSuccess firstName={firstName} />
    </MemoryRouter>
  );
}

describe('LoggedInSuccess', () => {
  it('shows the headline', () => {
    renderComponent();
    expect(
      screen.getByRole('heading', { name: /You're on Pro/i })
    ).toBeInTheDocument();
  });

  it('shows personalized subhead when firstName is provided', () => {
    renderComponent('Alex');
    expect(
      screen.getByText(/Thanks, Alex — your subscription is active\./)
    ).toBeInTheDocument();
  });

  it('shows fallback subhead when firstName is absent', () => {
    renderComponent();
    expect(
      screen.getByText('Your subscription is active.')
    ).toBeInTheDocument();
  });

  it('navigates to /upload when Make a deck is clicked', () => {
    renderComponent('Alex');
    fireEvent.click(screen.getByRole('button', { name: /Make a deck/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/upload');
  });

  it('renders a Go to account link', () => {
    renderComponent();
    const link = screen.getByRole('link', { name: /Go to account/i });
    expect(link).toHaveAttribute('href', '/account');
  });
});

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { RightSide } from './RightSide';

function getNavLinks() {
  return Array.from(document.querySelectorAll('nav, [role="navigation"], div'))
    .flatMap((el) => Array.from(el.querySelectorAll('a')))
    .filter((a, idx, arr) => arr.findIndex((b) => b === a) === idx);
}

describe('RightSide (anonymous nav)', () => {
  it('renders Upload, Docs, and Login in order', () => {
    render(<RightSide path="/" isLoggedIn={false} />);
    const upload = screen.getByRole('link', { name: 'Make flashcards' });
    const docs = screen.getByRole('link', { name: 'Docs' });
    const login = screen.getByRole('link', { name: 'Log in' });

    expect(upload).toBeInTheDocument();
    expect(docs).toBeInTheDocument();
    expect(login).toBeInTheDocument();

    const positions = getNavLinks().map((a) => a.textContent);
    const uploadIdx = positions.indexOf('Make flashcards');
    const docsIdx = positions.indexOf('Docs');
    expect(uploadIdx).toBeGreaterThanOrEqual(0);
    expect(docsIdx).toBeGreaterThan(uploadIdx);
  });

  it('omits the Pricing link for logged-out visitors', () => {
    render(<RightSide path="/" isLoggedIn={false} />);
    expect(
      screen.queryByRole('link', { name: 'Pricing' })
    ).not.toBeInTheDocument();
  });

  it('keeps the Pricing link for logged-in visitors', () => {
    render(<RightSide path="/" isLoggedIn />);
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute(
      'href',
      '/pricing'
    );
  });

  it('Docs link points to /documentation', () => {
    render(<RightSide path="/" isLoggedIn={false} />);
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute(
      'href',
      '/documentation'
    );
  });

  it('does not render the legacy Documentation label', () => {
    render(<RightSide path="/" isLoggedIn={false} />);
    expect(
      screen.queryByRole('link', { name: 'Documentation' })
    ).not.toBeInTheDocument();
  });

  it('shows a Download link to /app for logged-out visitors', () => {
    render(<RightSide path="/" isLoggedIn={false} />);
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/app'
    );
  });

  it('omits the Download link for logged-in visitors', () => {
    render(<RightSide path="/" isLoggedIn />);
    expect(
      screen.queryByRole('link', { name: 'Download' })
    ).not.toBeInTheDocument();
  });
});

describe('RightSide redesign variants (anonymous)', () => {
  const variants = ['quiet', 'oneCta', 'convertOrSignIn'] as const;

  it.each(variants)(
    '%s orders links Print, Docs, Download, Log in, CTA',
    (variant) => {
      render(<RightSide path="/" isLoggedIn={false} variant={variant} />);
      const labels = screen.getAllByRole('link').map((a) => a.textContent);
      expect(labels).toEqual([
        'Print Decks',
        'Docs',
        'Download',
        'Log in',
        'Make flashcards',
      ]);
    }
  );

  it.each(variants)('%s keeps the CTA pointed at /upload', (variant) => {
    render(<RightSide path="/" isLoggedIn={false} variant={variant} />);
    expect(
      screen.getByRole('link', { name: 'Make flashcards' })
    ).toHaveAttribute('href', '/upload');
  });

  it('quiet and convertOrSignIn show the 2-letter language code, oneCta hides it', () => {
    const { unmount } = render(
      <RightSide path="/" isLoggedIn={false} variant="quiet" />
    );
    expect(screen.getByText('EN')).toBeInTheDocument();
    unmount();

    render(<RightSide path="/" isLoggedIn={false} variant="oneCta" />);
    expect(screen.queryByText('EN')).not.toBeInTheDocument();
  });

  it('every variant keeps the language select and theme toggle accessible', () => {
    for (const variant of variants) {
      const { unmount } = render(
        <RightSide path="/" isLoggedIn={false} variant={variant} />
      );
      expect(
        screen.getByRole('combobox', { name: 'Language' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Cycle theme' })
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('default variant renders the current navbar unchanged', () => {
    render(<RightSide path="/" isLoggedIn={false} />);
    const labels = screen.getAllByRole('link').map((a) => a.textContent);
    expect(labels).toEqual([
      'Make flashcards',
      'Print Decks',
      'Docs',
      'Download',
      'Log in',
    ]);
  });
});

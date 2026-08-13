import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import NavigationBar from '../NavigationBar';
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

describe('NavigationBar redesign variants (anonymous)', () => {
  const variants = ['groupedLeft', 'centered', 'deck'] as const;

  it.each(variants)(
    '%s orders links Print, Docs, Download, then Log in and the CTA',
    (variant) => {
      render(<NavigationBar isLoggedIn={false} variant={variant} />);
      const labels = screen
        .getAllByRole('link', { hidden: true })
        .map((a) => a.textContent)
        .filter((text) => text !== '');
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
    render(<NavigationBar isLoggedIn={false} variant={variant} />);
    expect(
      screen.getByRole('link', { name: 'Make flashcards', hidden: true })
    ).toHaveAttribute('href', '/upload');
  });

  it.each(variants)(
    '%s shows the language code with a dropdown chevron',
    (variant) => {
      render(<NavigationBar isLoggedIn={false} variant={variant} />);
      expect(screen.getByText('EN')).toBeInTheDocument();
      expect(screen.getByText('▾')).toBeInTheDocument();
    }
  );

  it.each(variants)(
    '%s keeps the language select and theme toggle accessible',
    (variant) => {
      render(<NavigationBar isLoggedIn={false} variant={variant} />);
      expect(
        screen.getByRole('combobox', { name: 'Language', hidden: true })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Cycle theme', hidden: true })
      ).toBeInTheDocument();
    }
  );

  it('only the deck variant styles the CTA as a stacked card', () => {
    const { unmount } = render(
      <NavigationBar isLoggedIn={false} variant="deck" />
    );
    expect(
      screen.getByRole('link', { name: 'Make flashcards', hidden: true })
        .className
    ).toContain('navCtaDeck');
    unmount();

    render(<NavigationBar isLoggedIn={false} variant="groupedLeft" />);
    expect(
      screen.getByRole('link', { name: 'Make flashcards', hidden: true })
        .className
    ).not.toContain('navCtaDeck');
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

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it } from 'vitest';

import i18n from '../../../lib/i18n';
import { SkippedAiFilesNotice } from './SkippedAiFilesNotice';

describe('SkippedAiFilesNotice', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('names each file Claude made no cards from and why', () => {
    render(
      <SkippedAiFilesNotice
        files={[
          { name: 'week 3.pdf', reason: 'declined' },
          { name: 'scans.pdf', reason: 'no_text' },
        ]}
      />
    );

    expect(
      screen.getByText(
        'No cards came from 2 files. The other files are in this deck.'
      )
    ).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'week 3.pdf: Claude declined it. Reword or remove the part it would not answer, then upload it again.',
      'scans.pdf: Claude found no text to make cards from. Check the file has text in it.',
    ]);
  });

  it('leaves out a file whose reason it does not know', () => {
    render(
      <SkippedAiFilesNotice
        files={[
          { name: 'a.md', reason: 'toString' },
          { name: 'b.md', reason: 'too_large' },
        ]}
      />
    );

    expect(
      screen.getByText(
        'No cards came from 1 file. The other files are in this deck.'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('lists five files and counts the rest', () => {
    render(
      <SkippedAiFilesNotice
        files={['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({
          name: `${name}.md`,
          reason: 'no_text',
        }))}
      />
    );

    expect(
      screen.getByText(
        'No cards came from 7 files. The other files are in this deck.'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('And 2 more.')).toBeInTheDocument();
  });

  it('renders nothing when no reason is known', () => {
    const { container } = render(
      <SkippedAiFilesNotice files={[{ name: 'a.md', reason: 'exploded' }]} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('uses the Polish few plural form for three files', async () => {
    await i18n.changeLanguage('pl');
    render(
      <SkippedAiFilesNotice
        files={['a.md', 'b.md', 'c.md'].map((name) => ({
          name,
          reason: 'unreadable',
        }))}
      />
    );

    expect(
      screen.getByText(/Z 3 plików nie powstały żadne karty/)
    ).toBeInTheDocument();
  });
});

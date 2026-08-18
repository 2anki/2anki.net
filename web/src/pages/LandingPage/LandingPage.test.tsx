import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import LandingPage from './LandingPage';
import notionCopy from './copy/notion';
import pdfCopy from './copy/pdf';
import markdownCopy from './copy/markdown';
import usmleCopy from './copy/usmle';
import nursingCopy from './copy/nursing';
import japaneseCopy from './copy/japanese';
import medicalLectureSlidesCopy from './copy/medical-lecture-slides';
import { ankiFidelityProof } from './copy/ankiFidelityProof';
import powerpointCopy from './copy/powerpoint';
import goodnotesCopy from './copy/goodnotes';
import aiFlashcardGeneratorCopy from './copy/ai-flashcard-generator';
import { CONVERT_LANDING_PAGES } from '../ConvertLandingPage/convertLandingConfig';

function renderLandingPage(children: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <HelmetProvider>{children}</HelmetProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('LandingPage', () => {
  it('renders the per-route H1 from the copy file', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    const heading = screen.getByRole('heading', {
      level: 1,
      name: notionCopy.h1,
    });
    expect(heading).toBeInTheDocument();
  });

  it('renders the UploadForm drop zone above the fold', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    expect(screen.getByText(/Drop your files here/i)).toBeInTheDocument();
  });

  it('links the secondary CTA to /register with the source param', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    const link = screen.getByRole('link', { name: /sign up free/i });
    expect(link).toHaveAttribute(
      'href',
      `/register?source=${encodeURIComponent(notionCopy.pathname)}`
    );
  });

  it('renders all FAQ summaries closed by default', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    for (const faq of notionCopy.faqs) {
      const summary = screen.getByText(faq.q);
      expect(summary).toBeInTheDocument();
      const details = summary.closest('details');
      expect(details?.open).toBe(false);
    }
  });

  it('renders the three how-it-works steps with numbered circles', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('lists supported format tags', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    expect(screen.getByText('Notion')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('Markdown')).toBeInTheDocument();
  });

  it('renders the USMLE h1 and links CTA to the usmle-anki source', () => {
    renderLandingPage(
      <LandingPage copy={usmleCopy} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByRole('heading', { level: 1, name: usmleCopy.h1 })
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign up free/i });
    expect(link).toHaveAttribute(
      'href',
      `/register?source=${encodeURIComponent(usmleCopy.pathname)}`
    );
  });

  it('renders the nursing h1 and links CTA to the nursing-flashcards source', () => {
    renderLandingPage(
      <LandingPage copy={nursingCopy} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByRole('heading', { level: 1, name: nursingCopy.h1 })
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign up free/i });
    expect(link).toHaveAttribute(
      'href',
      `/register?source=${encodeURIComponent(nursingCopy.pathname)}`
    );
  });

  it('renders the Japanese h1, the source-wired CTA, and a FAQ', () => {
    renderLandingPage(
      <LandingPage copy={japaneseCopy} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByRole('heading', { level: 1, name: japaneseCopy.h1 })
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign up free/i });
    expect(link).toHaveAttribute(
      'href',
      `/register?source=${encodeURIComponent(japaneseCopy.pathname)}`
    );
    expect(
      screen.getByText('Can I mine sentences from Notion?')
    ).toBeInTheDocument();
  });

  it('renders the medical lecture slides h1 and links CTA to the correct source', () => {
    renderLandingPage(
      <LandingPage copy={medicalLectureSlidesCopy} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: medicalLectureSlidesCopy.h1,
      })
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign up free/i });
    expect(link).toHaveAttribute(
      'href',
      `/register?source=${encodeURIComponent(medicalLectureSlidesCopy.pathname)}`
    );
  });

  it('renders the fidelity proof under the "What you actually get in Anki" label', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByText('What you actually get in Anki')
    ).toBeInTheDocument();
    for (const item of ankiFidelityProof) {
      expect(screen.getByText(item.title)).toBeInTheDocument();
    }
  });

  it('omits the proof section when the copy has no whatComesAcross', () => {
    const copyWithoutProof = { ...notionCopy, whatComesAcross: undefined };
    renderLandingPage(
      <LandingPage copy={copyWithoutProof} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.queryByText('What you actually get in Anki')
    ).not.toBeInTheDocument();
  });

  it.each([
    [notionCopy, 'https://2anki.net/notion-to-anki/'],
    [pdfCopy, 'https://2anki.net/pdf-to-anki/'],
    [markdownCopy, 'https://2anki.net/markdown-to-anki/'],
  ])(
    'self-references the trailing-slash canonical the prerender emits for %s',
    async (copy, expectedCanonical) => {
      renderLandingPage(<LandingPage copy={copy} setErrorMessage={vi.fn()} />);
      await waitFor(() => {
        const canonical = document.head.querySelector('link[rel="canonical"]');
        expect(canonical).toHaveAttribute('href', expectedCanonical);
      });
    }
  );

  it.each([
    ['notion-to-anki', 'https://2anki.net/notion-to-anki/'],
    ['pdf-to-anki', 'https://2anki.net/pdf-to-anki/'],
    ['markdown-to-anki', 'https://2anki.net/markdown-to-anki/'],
  ])(
    'points the /convert/%s canonical at the top-level slug',
    async (slug, expectedCanonical) => {
      const copy = CONVERT_LANDING_PAGES.get(slug)!;
      renderLandingPage(<LandingPage copy={copy} setErrorMessage={vi.fn()} />);
      await waitFor(() => {
        const canonical = document.head.querySelector('link[rel="canonical"]');
        expect(canonical).toHaveAttribute('href', expectedCanonical);
      });
      const ogUrl = document.head.querySelector('meta[property="og:url"]');
      expect(ogUrl).toHaveAttribute(
        'content',
        `https://2anki.net/convert/${slug}/`
      );
    }
  );

  it('renders the PowerPoint h1 and links CTA to the powerpoint-to-anki source', () => {
    renderLandingPage(
      <LandingPage copy={powerpointCopy} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByRole('heading', { level: 1, name: powerpointCopy.h1 })
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign up free/i });
    expect(link).toHaveAttribute(
      'href',
      `/register?source=${encodeURIComponent(powerpointCopy.pathname)}`
    );
  });

  it('renders the GoodNotes h1 and links CTA to the goodnotes-to-anki source', () => {
    renderLandingPage(
      <LandingPage copy={goodnotesCopy} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByRole('heading', { level: 1, name: goodnotesCopy.h1 })
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign up free/i });
    expect(link).toHaveAttribute(
      'href',
      `/register?source=${encodeURIComponent(goodnotesCopy.pathname)}`
    );
  });

  it('renders the Related nav with every relatedLink when the copy has them', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    const related = screen.getByRole('navigation', { name: 'Related' });
    expect(related).toBeInTheDocument();
    for (const link of notionCopy.relatedLinks ?? []) {
      const anchor = screen.getByRole('link', { name: link.label });
      expect(anchor).toHaveAttribute('href', link.href);
    }
  });

  it('links the Notion Integration Gallery badge to the public gallery listing', () => {
    renderLandingPage(
      <LandingPage copy={notionCopy} setErrorMessage={vi.fn()} />
    );
    const badgeLink = screen.getByRole('link', {
      name: 'Notion Integration Gallery',
    });
    expect(badgeLink).toHaveAttribute(
      'href',
      'https://www.notion.com/connections/2anki'
    );
    expect(badgeLink).toHaveAttribute('target', '_blank');
    expect(badgeLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits the gallery badge when the copy has no galleryBadge flag', () => {
    renderLandingPage(<LandingPage copy={pdfCopy} setErrorMessage={vi.fn()} />);
    expect(
      screen.queryByRole('link', { name: 'Notion Integration Gallery' })
    ).not.toBeInTheDocument();
  });

  it('omits the Related nav when the copy has no relatedLinks', () => {
    const copyWithoutRelated = { ...notionCopy, relatedLinks: undefined };
    renderLandingPage(
      <LandingPage copy={copyWithoutRelated} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.queryByRole('navigation', { name: 'Related' })
    ).not.toBeInTheDocument();
  });

  it('renders the AI flashcard generator h1 and links CTA to the ai-flashcard-generator source', () => {
    renderLandingPage(
      <LandingPage copy={aiFlashcardGeneratorCopy} setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: aiFlashcardGeneratorCopy.h1,
      })
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign up free/i });
    expect(link).toHaveAttribute(
      'href',
      `/register?source=${encodeURIComponent(aiFlashcardGeneratorCopy.pathname)}`
    );
  });
});

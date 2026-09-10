import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AnswersPage, { buildArticleJsonLd, buildFaqJsonLd } from './AnswersPage';
import { ANSWERS_PAGES } from './answersConfig';

function renderAtSlug(slug: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/answers/${slug}`]}>
        <Routes>
          <Route path="/answers/:slug" element={<AnswersPage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('AnswersPage', () => {
  it('renders the h1 for a known slug', () => {
    const config = ANSWERS_PAGES.get('convert-notion-to-anki');
    renderAtSlug('convert-notion-to-anki');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      config!.h1
    );
  });

  it('renders all section headings for a known slug', () => {
    const config = ANSWERS_PAGES.get('pdf-to-anki');
    renderAtSlug('pdf-to-anki');
    for (const section of config!.sections) {
      expect(screen.getByText(section.heading)).toBeInTheDocument();
    }
  });

  it('renders the not-found page for an unknown slug', () => {
    renderAtSlug('does-not-exist');
    expect(
      screen.getByRole('heading', { name: 'Page not found' })
    ).toBeInTheDocument();
  });

  it('all related links contain ?ref=ai', () => {
    for (const [slug, config] of Array.from(ANSWERS_PAGES.entries())) {
      renderAtSlug(slug);
      for (const link of config.relatedLinks) {
        expect(link.href).toContain('?ref=ai');
      }
    }
  });

  it('renders the notion-to-anki-sync page', () => {
    const config = ANSWERS_PAGES.get('notion-to-anki-sync');
    renderAtSlug('notion-to-anki-sync');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      config!.h1
    );
  });

  it('renders the quizlet-to-anki page', () => {
    const config = ANSWERS_PAGES.get('quizlet-to-anki');
    renderAtSlug('quizlet-to-anki');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      config!.h1
    );
  });

  it('builds Article JSON-LD and never FAQPage or Question', () => {
    const config = ANSWERS_PAGES.get('fsrs-explained')!;
    const raw = buildArticleJsonLd(config);
    const data = JSON.parse(raw);

    expect(data['@type']).toBe('Article');
    expect(data.headline).toBe(config.title);
    expect(data.description).toBe(config.description);
    expect(data.mainEntityOfPage['@id']).toBe(
      `https://2anki.net/answers/${config.slug}`
    );
    expect(raw).not.toContain('FAQPage');
    expect(raw).not.toContain('Question');
  });

  it('maps section headings to articleSection and bodies to articleBody', () => {
    const config = ANSWERS_PAGES.get('convert-notion-to-anki')!;
    const data = JSON.parse(buildArticleJsonLd(config));

    expect(data.articleSection).toEqual(
      config.sections.map((section) => section.heading)
    );
    for (const section of config.sections) {
      expect(data.articleBody).toContain(section.body);
    }
  });

  it('emits Article JSON-LD for every Answers page', () => {
    for (const config of Array.from(ANSWERS_PAGES.values())) {
      const data = JSON.parse(buildArticleJsonLd(config));
      expect(data['@type']).toBe('Article');
    }
  });

  it('returns null FAQ JSON-LD for a page without faqs', () => {
    const config = ANSWERS_PAGES.get('fsrs-explained')!;
    expect(buildFaqJsonLd(config)).toBeNull();
  });

  it('builds FAQPage JSON-LD from faqs', () => {
    const config = ANSWERS_PAGES.get('lecture-notes-to-anki')!;
    const raw = buildFaqJsonLd(config);
    const data = JSON.parse(raw!);

    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity).toHaveLength(config.faqs!.length);
    expect(data.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: config.faqs![0].q,
      acceptedAnswer: { '@type': 'Answer', text: config.faqs![0].a },
    });
  });

  it('renders the FAQ block on a page with faqs', () => {
    const config = ANSWERS_PAGES.get('word-to-anki')!;
    renderAtSlug('word-to-anki');
    for (const faq of config.faqs!) {
      expect(screen.getByText(faq.q)).toBeInTheDocument();
    }
  });

  it.each([
    'lecture-notes-to-anki',
    'word-to-anki',
    'image-occlusion-anki',
    'google-docs-to-anki',
    'handwritten-notes-to-anki',
    'textbook-to-anki',
    'kindle-highlights-to-anki',
    'language-app-to-anki',
    'obsidian-to-anki',
    'claude-to-anki',
    'chatgpt-to-anki',
    'gemini-to-anki',
  ])('renders the %s page', (slug) => {
    const config = ANSWERS_PAGES.get(slug)!;
    renderAtSlug(slug);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      config.h1
    );
  });
});

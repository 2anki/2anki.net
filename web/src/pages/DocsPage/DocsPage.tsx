import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { DocsSidebar } from './DocsSidebar';
import { DocContent } from './DocContent';
import { DocsHome } from './DocsHome';
import { DocsSearchTrigger } from './DocsSearchTrigger';
import { DocsSearch } from './DocsSearch';
import { WipBanner } from './WipBanner';
import { loadDoc } from './loader';
import { buildDocDescription, buildDocTitle } from './docMeta';
import styles from './DocsPage.module.css';

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 47) end--;
  return end === value.length ? value : value.slice(0, end);
}

const LEGAL_SLUGS = new Set(['reference/privacy', 'reference/terms']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export default function DocsPage() {
  const params = useParams();
  const { pathname } = useLocation();
  const { i18n } = useTranslation();
  const slug = stripTrailingSlashes(params['*'] ?? '');
  const [searchOpen, setSearchOpen] = useState(false);

  const doc = slug ? loadDoc(slug, i18n.resolvedLanguage) : null;
  const metaTitle = buildDocTitle(doc?.frontmatter.title);
  const metaDescription =
    doc != null ? buildDocDescription(doc.frontmatter, doc.body) : undefined;
  const canonical = `https://2anki.net${pathname}`;

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === '/' && !searchOpen && !isTypingTarget(event.target)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

  return (
    <div className={styles.layout}>
      <Helmet>
        <title>{metaTitle}</title>
        {metaDescription != null && (
          <meta name="description" content={metaDescription} />
        )}
        <link rel="canonical" href={canonical} />
      </Helmet>

      <div className={styles.mobileSearch}>
        <DocsSearchTrigger onOpen={openSearch} />
      </div>

      <aside id="docs-sidebar" className={styles.sidebarWrapper}>
        <DocsSidebar onSearch={openSearch} activeSlug={slug} />
      </aside>

      <DocsSearch isOpen={searchOpen} onClose={closeSearch} />

      <main
        className={styles.main}
        data-legal={LEGAL_SLUGS.has(slug) ? 'true' : undefined}
      >
        <WipBanner />
        {slug ? <DocContent slug={slug} /> : <DocsHome />}
      </main>
    </div>
  );
}

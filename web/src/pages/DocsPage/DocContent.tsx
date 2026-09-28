import { AnchorHTMLAttributes, useEffect, useMemo } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import { loadDoc, resolveSlug } from './loader';
import { findAdjacent, redirects } from './sidebar';
import { CalloutVariant } from './Callout';
import { CodeBlock } from './CodeBlock';
import { OverlappingClozePreview } from '../../components/CardOptionsForm/OverlappingClozePreview';
import styles from './DocsPage.module.css';

interface DocContentProps {
  slug: string;
}

function isExternal(href: string) {
  return /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:');
}

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement>;

function DocsAnchor({ href, children, ...rest }: AnchorProps) {
  const navigate = useNavigate();

  if (!href) return <a {...rest}>{children}</a>;

  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }

  const to = href.length > 1 && href.endsWith('/') ? href.slice(0, -1) : href;
  const isAppRoute = to.startsWith('/documentation') || to === '/documentation';
  const handlesClientSide = isAppRoute || to.startsWith('/pricing');

  return (
    <a
      href={to}
      onClick={(e) => {
        if (
          !handlesClientSide ||
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

const CALLOUT_VARIANT_CLASS: Record<CalloutVariant, string> = {
  note: 'callout-note',
  tip: 'callout-tip',
  warning: 'callout-warning',
};

function parseCalloutOpen(line: string): CalloutVariant | null {
  if (!line.startsWith(':::')) return null;
  const rest = line.slice(3).trim();
  return Object.hasOwn(CALLOUT_VARIANT_CLASS, rest)
    ? (rest as CalloutVariant)
    : null;
}

function isCalloutClose(line: string): boolean {
  return line.trim() === ':::';
}

function transformCallouts(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const variant = parseCalloutOpen(lines[i]);
    if (variant == null) {
      out.push(lines[i]);
      i++;
      continue;
    }
    let close = i + 1;
    while (close < lines.length && !isCalloutClose(lines[close])) close++;
    if (close >= lines.length) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const inner = lines
      .slice(i + 1, close)
      .join('\n')
      .trim();
    out.push(
      `<aside class="callout ${CALLOUT_VARIANT_CLASS[variant]}">`,
      '',
      inner,
      '',
      '</aside>'
    );
    i = close + 1;
  }
  return out.join('\n');
}

function OverlappingClozeDemo(props: Record<string, unknown>) {
  const style = props['data-style'] === 'windowed' ? 'windowed' : 'show-all';
  return <OverlappingClozePreview style={style} />;
}

const markdownComponents = {
  a: DocsAnchor,
  pre: CodeBlock as Components['pre'],
  'overlapping-cloze-demo': OverlappingClozeDemo,
} as unknown as Components;
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeRaw, rehypeSlug];

const EDIT_BASE = 'https://github.com/2anki/server/edit/main/';

export function DocContent({ slug }: Readonly<DocContentProps>) {
  const { t, i18n } = useTranslation('docs');
  const doc = loadDoc(slug, i18n.resolvedLanguage);
  const { hash } = useLocation();
  const resolvedSlug = resolveSlug(slug);

  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    const el = document.getElementById(id);
    if (el) el.scrollIntoView();
  }, [slug, hash]);

  const { prev, next } = useMemo(
    () => findAdjacent(resolvedSlug),
    [resolvedSlug]
  );

  if (slug !== resolvedSlug && Object.hasOwn(redirects, slug)) {
    return <Navigate to={`/documentation/${resolvedSlug}`} replace />;
  }

  if (!doc) {
    return (
      <article key={resolvedSlug} className={styles.article}>
        <h1>{t('content.notFoundTitle')}</h1>
        <p>
          <Trans
            i18nKey="docs:content.notFoundBody"
            components={{ back: <Link to="/documentation" /> }}
          />
        </p>
      </article>
    );
  }

  const { frontmatter, body, sourcePath } = doc;
  const editUrl = `${EDIT_BASE}${sourcePath}`;
  const transformedBody = transformCallouts(body);

  return (
    <article key={resolvedSlug} className={styles.article}>
      <header className={styles.articleHeader}>
        {frontmatter.title && (
          <h1 className={styles.articleTitle}>{frontmatter.title}</h1>
        )}
        {frontmatter.description && (
          <p className={styles.articleDescription}>{frontmatter.description}</p>
        )}
      </header>

      <div className={styles.markdown}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={markdownComponents}
        >
          {transformedBody}
        </ReactMarkdown>
      </div>

      <div className={styles.editFooter}>
        <a
          href={editUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.editLink}
        >
          {t('content.editOnGitHub')}
        </a>
      </div>

      <nav className={styles.pager} aria-label={t('content.pagerLabel')}>
        {prev ? (
          <Link to={`/documentation/${prev.slug}`} className={styles.pagerPrev}>
            <span className={styles.pagerLabel}>{t('content.previous')}</span>
            <span className={styles.pagerTitle}>{prev.label}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={`/documentation/${next.slug}`} className={styles.pagerNext}>
            <span className={styles.pagerLabel}>{t('content.next')}</span>
            <span className={styles.pagerTitle}>{next.label}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

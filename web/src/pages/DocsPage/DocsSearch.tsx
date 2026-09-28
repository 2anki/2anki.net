import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import {
  docCount,
  popularResults,
  searchDocs,
  splitHighlight,
  tokenize,
  type SearchResult,
} from './search';
import styles from './DocsPage.module.css';

interface DocsSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

function Highlighted({
  text,
  terms,
}: Readonly<{ text: string; terms: string[] }>) {
  let offset = 0;
  return (
    <>
      {splitHighlight(text, terms).map((segment) => {
        const key = `${offset}:${segment.text}`;
        offset += segment.text.length;
        return segment.hit ? (
          <strong key={key} className={styles.searchHit}>
            {segment.text}
          </strong>
        ) : (
          <span key={key}>{segment.text}</span>
        );
      })}
    </>
  );
}

export function DocsSearch({ isOpen, onClose }: Readonly<DocsSearchProps>) {
  const { t } = useTranslation('docs');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const terms = useMemo(() => tokenize(query), [query]);
  const trimmed = query.trim();
  const results = useMemo<SearchResult[]>(
    () => (trimmed ? searchDocs(query) : popularResults()),
    [query, trimmed]
  );

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    const row = listRef.current?.children[selected];
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  if (!isOpen) return null;

  const open = (result: SearchResult) => {
    navigate(`/documentation/${result.slug}`);
    onClose();
  };

  const onResultClick = (event: React.MouseEvent, result: SearchResult) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    open(result);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(results[selected]);
    }
  };

  const noResults = trimmed.length > 0 && results.length === 0;

  return (
    <div
      className={styles.searchOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={t('search.dialogLabel')}
    >
      <button
        type="button"
        className={styles.searchBackdrop}
        onClick={onClose}
        aria-label={t('search.close')}
      />
      <div className={styles.searchModal}>
        <div className={styles.searchInputRow}>
          <span className={styles.searchInputIcon} aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            className={styles.searchInput}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            aria-haspopup="listbox"
            aria-expanded={results.length > 0}
            aria-controls="docs-search-results"
            aria-activedescendant={
              results.length > 0 ? `docs-search-option-${selected}` : undefined
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className={styles.searchClose}
            onClick={onClose}
            aria-label={t('search.close')}
          >
            ×
          </button>
        </div>

        {!trimmed && (
          <div className={styles.searchHint}>
            {t('search.hint', { total: docCount() })}
          </div>
        )}

        {noResults ? (
          <div className={styles.searchEmpty}>
            <p className={styles.searchEmptyTitle}>
              <Trans
                i18nKey="docs:search.noMatch"
                values={{ query: trimmed }}
                components={{
                  q: <span className={styles.searchQuery} />,
                }}
              />
            </p>
            <p className={styles.searchEmptyBody}>
              <Trans
                i18nKey="docs:search.checkSpelling"
                components={{
                  browse: (
                    <button
                      type="button"
                      className={styles.searchBrowseLink}
                      onClick={() => {
                        navigate('/documentation');
                        onClose();
                      }}
                    />
                  ),
                }}
              />
            </p>
          </div>
        ) : (
          <div
            ref={listRef}
            id="docs-search-results"
            className={styles.searchResults}
            role="listbox"
            aria-label={t('search.resultsLabel')}
          >
            {results.map((result, index) => (
              <a
                key={result.slug}
                id={`docs-search-option-${index}`}
                role="option"
                href={`/documentation/${result.slug}`}
                tabIndex={-1}
                aria-selected={index === selected}
                className={`${styles.searchResult} ${
                  index === selected ? styles.searchResultActive : ''
                }`}
                onMouseEnter={() => setSelected(index)}
                onClick={(event) => onResultClick(event, result)}
              >
                <span className={styles.searchResultTitle}>
                  <Highlighted text={result.title} terms={terms} />
                </span>
                <span className={styles.searchResultMeta}>
                  <span className={styles.searchResultGroup}>
                    {result.group}
                  </span>
                  {result.snippet && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className={styles.searchResultSnippet}>
                        <Highlighted text={result.snippet} terms={terms} />
                      </span>
                    </>
                  )}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

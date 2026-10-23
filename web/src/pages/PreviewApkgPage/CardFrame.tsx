import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApkgPreviewCard } from '../../lib/backend/getApkgPreview';
import { CardEditState } from './cardEditTypes';
import { fetchMediaAsDataUrl, inlineApkgMedia } from './inlineMedia';
import { useTheme } from '../../lib/hooks/useTheme';
import styles from './PreviewApkgPage.module.css';

interface CardFrameProps {
  card: ApkgPreviewCard;
  cardIndex?: number;
  editState?: CardEditState;
  onEdit?: (index: number, state: CardEditState) => void;
  isEditable?: boolean;
}

const mediaCache = new Map<string, string | null>();

const MATHJAX_CDN =
  'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';

function containsMath(html: string): boolean {
  return html.includes('\\(') || html.includes('\\[');
}

function mathJaxTags(html: string): string {
  if (!containsMath(html)) return '';
  return `<script>
window.MathJax = {
  tex: { inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] },
  options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] }
};
</script>
<script async src="${MATHJAX_CDN}"></script>`;
}

function buildSrcDoc(
  html: string,
  css: string,
  cardId: string,
  isDark: boolean
): string {
  const colorScheme = isDark ? 'dark' : 'light';
  const bodyClass = isDark ? ' class="nightMode"' : '';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${colorScheme}">
<base target="_blank">
<script>
(function () {
  // Preview iframes run with an opaque origin (sandbox="allow-scripts", no
  // allow-same-origin), so sessionStorage/localStorage access throws
  // SecurityError. Anki note templates — including the Anki Persistence library
  // the MCQ card uses — read sessionStorage during init; an unhandled throw
  // short-circuits the rest of the script and the click handlers never attach.
  // Swap in an in-memory store so template scripts run to completion without
  // weakening the sandbox to allow-same-origin.
  function makeStore() {
    var data = {};
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
      },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      clear: function () { data = {}; },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; }
    };
  }
  ['sessionStorage', 'localStorage'].forEach(function (name) {
    var usable = false;
    try {
      window[name].getItem('__2anki_probe__');
      usable = true;
    } catch (e) {
      usable = false;
    }
    if (!usable) {
      try {
        Object.defineProperty(window, name, {
          value: makeStore(),
          configurable: true
        });
      } catch (e) {}
    }
  });
})();
</script>
<style>
  html, body { margin: 0; padding: 1rem; font-family: system-ui, sans-serif; }
  img, video { max-width: 100%; height: auto; }
${css}
</style>
${mathJaxTags(html)}
</head>
<body${bodyClass}>
<div class="card">${html}</div>
<script>
(function () {
  var cardId = ${JSON.stringify(cardId)};
  function post() {
    window.parent.postMessage(
      { source: '2anki-preview', cardId: cardId, height: document.documentElement.scrollHeight },
      '*'
    );
  }
  window.addEventListener('load', post);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(post).observe(document.documentElement);
  }
})();
</script>
</body>
</html>`;
}

function resolveDeckSegments(card: ApkgPreviewCard): string[] {
  if (Array.isArray(card.deckPath) && card.deckPath.length > 0) {
    return card.deckPath;
  }
  if (card.deckName) return card.deckName.split('::');
  return [];
}

const MAX_FRAME_HEIGHT = 2000;
const DEFAULT_FRAME_HEIGHT = 320;

export function CardFrame({
  card,
  cardIndex,
  editState,
  onEdit,
  isEditable,
}: Readonly<CardFrameProps>) {
  const { t } = useTranslation('previews');
  const [showBack, setShowBack] = useState(false);
  const [frameHeight, setFrameHeight] = useState(DEFAULT_FRAME_HEIGHT);
  const [editingFront, setEditingFront] = useState(false);
  const [editingBack, setEditingBack] = useState(false);
  const [draftFront, setDraftFront] = useState('');
  const [draftBack, setDraftBack] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Each document gets a freshly mounted frame: Chrome leaves a sandboxed
  // frame blank when its srcdoc changes a few milliseconds after it was
  // inserted with an empty one.
  const [frameDoc, setFrameDoc] = useState<{
    srcDoc: string;
    version: number;
  } | null>(null);
  const theme = useTheme();
  const isDark = theme === 'dark';
  const deckSegments = useMemo(() => resolveDeckSegments(card), [card]);

  const isDeleted = editState?.deleted ?? false;
  const isSuspended = editState?.suspended ?? false;
  const effectiveFront = editState?.front ?? card.front;
  const effectiveBack = editState?.back ?? card.back;

  useEffect(() => {
    let cancelled = false;
    const cardId = String(card.id);
    const html = showBack ? effectiveBack : effectiveFront;
    inlineApkgMedia(html, fetchMediaAsDataUrl, mediaCache).then((inlined) => {
      if (cancelled) return;
      const srcDoc = buildSrcDoc(inlined, card.css, cardId, isDark);
      setFrameDoc((prev) => ({ srcDoc, version: (prev?.version ?? 0) + 1 }));
    });
    return () => {
      cancelled = true;
    };
  }, [card, showBack, effectiveFront, effectiveBack, isDark]);

  useEffect(() => {
    setFrameHeight(DEFAULT_FRAME_HEIGHT);
  }, [card.id, showBack]);

  useEffect(() => {
    const cardId = String(card.id);
    function handleMessage(event: MessageEvent) {
      if (event.origin !== 'null') return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (
        data?.source !== '2anki-preview' ||
        data?.cardId !== cardId ||
        typeof data?.height !== 'number'
      )
        return;
      setFrameHeight(Math.min(data.height, MAX_FRAME_HEIGHT));
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [card.id]);

  function commitFrontEdit() {
    if (onEdit != null && cardIndex != null) {
      onEdit(cardIndex, { ...editState, front: draftFront });
    }
    setEditingFront(false);
  }

  function commitBackEdit() {
    if (onEdit != null && cardIndex != null) {
      onEdit(cardIndex, { ...editState, back: draftBack });
    }
    setEditingBack(false);
  }

  function handleFrontKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitFrontEdit();
    }
    if (e.key === 'Escape') {
      setEditingFront(false);
    }
  }

  function handleBackKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitBackEdit();
    }
    if (e.key === 'Escape') {
      setEditingBack(false);
    }
  }

  function toggleDelete() {
    if (onEdit != null && cardIndex != null) {
      onEdit(cardIndex, { ...editState, deleted: !isDeleted });
    }
  }

  function toggleSuspend() {
    if (onEdit != null && cardIndex != null) {
      onEdit(cardIndex, { ...editState, suspended: !isSuspended });
    }
  }

  return (
    <section
      className={`${styles.card}${isDeleted ? ` ${styles.cardDeleted}` : ''}`}
    >
      <header className={styles.cardHeader}>
        <div className={styles.cardDeckPath}>
          {deckSegments.map((segment, idx) => (
            <span key={`${segment}-${idx}`} className={styles.cardDeckSegment}>
              {idx > 0 && (
                <span className={styles.cardDeckSeparator} aria-hidden="true">
                  ›
                </span>
              )}
              {segment}
            </span>
          ))}
          <span className={styles.cardDot} aria-hidden="true">
            ·
          </span>
          <span className={styles.cardTemplate}>{card.templateName}</span>
        </div>
        <div className={styles.cardControls}>
          {isEditable && (
            <>
              <button
                type="button"
                className={`${styles.iconButton}${isSuspended ? ` ${styles.iconButtonActive}` : ''}`}
                onClick={toggleSuspend}
                aria-pressed={isSuspended}
                title={t('card.suspendOnImport')}
              >
                {t('card.suspend')}
              </button>
              <button
                type="button"
                className={`${styles.iconButton}${isDeleted ? ` ${styles.iconButtonActive}` : ''}`}
                onClick={toggleDelete}
                aria-pressed={isDeleted}
                title={isDeleted ? t('card.restoreCard') : t('card.deleteCard')}
              >
                {isDeleted ? t('card.restore') : t('card.delete')}
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.flipButton}
            onClick={() => setShowBack((prev) => !prev)}
            aria-pressed={showBack}
          >
            {showBack ? t('card.showFront') : t('card.showBack')}
          </button>
        </div>
      </header>
      {frameDoc == null ? (
        <div className={styles.cardFrame} style={{ height: frameHeight }} />
      ) : (
        <iframe
          key={frameDoc.version}
          ref={iframeRef}
          className={styles.cardFrame}
          title={t('card.frameTitle', {
            deck: card.deckName,
            template: card.templateName,
            side: showBack ? t('card.back') : t('card.front'),
          })}
          sandbox="allow-scripts"
          srcDoc={frameDoc.srcDoc}
          style={{ height: frameHeight }}
        />
      )}
      {isEditable && (
        <div className={styles.editPanel}>
          <div className={styles.editFieldGroup}>
            <label className={styles.editLabel} htmlFor={`front-${card.id}`}>
              {t('card.frontLabel')}
            </label>
            {editingFront ? (
              <textarea
                id={`front-${card.id}`}
                className={styles.editableField}
                value={draftFront}
                onChange={(e) => setDraftFront(e.target.value)}
                onKeyDown={handleFrontKeyDown}
                onBlur={commitFrontEdit}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => {
                  setDraftFront(editState?.front ?? card.front);
                  setEditingFront(true);
                }}
              >
                {t('card.editFront')}
              </button>
            )}
          </div>
          <div className={styles.editFieldGroup}>
            <label className={styles.editLabel} htmlFor={`back-${card.id}`}>
              {t('card.backLabel')}
            </label>
            {editingBack ? (
              <textarea
                id={`back-${card.id}`}
                className={styles.editableField}
                value={draftBack}
                onChange={(e) => setDraftBack(e.target.value)}
                onKeyDown={handleBackKeyDown}
                onBlur={commitBackEdit}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => {
                  setDraftBack(editState?.back ?? card.back);
                  setEditingBack(true);
                }}
              >
                {t('card.editBack')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

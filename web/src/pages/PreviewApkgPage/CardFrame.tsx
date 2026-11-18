import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApkgEditableField,
  ApkgPreviewCard,
} from '../../lib/backend/getApkgPreview';
import {
  CardEditState,
  withFieldDraft,
  withoutFieldBreakingCharacters,
} from './cardEditTypes';
import { fetchMediaAsDataUrl, inlineApkgMedia } from './inlineMedia';
import { useTheme } from '../../lib/hooks/useTheme';
import styles from './PreviewApkgPage.module.css';

interface CardFrameProps {
  card: ApkgPreviewCard;
  editState?: CardEditState;
  onEdit?: (cardId: number, state: CardEditState) => void;
  isEditable?: boolean;
}

interface FieldEditorProps {
  cardId: number;
  side: 'front' | 'back';
  field: ApkgEditableField;
  editedValue: string | undefined;
  onCommit: (draft: string) => void;
}

function FieldEditor({
  cardId,
  side,
  field,
  editedValue,
  onCommit,
}: Readonly<FieldEditorProps>) {
  const { t } = useTranslation('previews');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const labelId = `${side}-field-${cardId}`;

  function commit() {
    onCommit(draft);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  return (
    <div className={styles.editFieldGroup}>
      <div className={styles.editLabelRow}>
        <span id={labelId} className={styles.editLabel} data-hj-suppress>
          {field.fieldName}
        </span>
        {editedValue != null && (
          <span className={styles.editedMarker}>{t('card.edited')}</span>
        )}
      </div>
      {editing ? (
        <textarea
          aria-labelledby={labelId}
          className={styles.editableField}
          value={draft}
          onChange={(e) =>
            setDraft(withoutFieldBreakingCharacters(e.target.value))
          }
          onKeyDown={handleKeyDown}
          onBlur={commit}
          autoFocus
          data-hj-suppress
        />
      ) : (
        <>
          {editedValue != null && (
            <p className={styles.editedValue} data-hj-suppress>
              {editedValue}
            </p>
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-describedby={labelId}
            onClick={() => {
              setDraft(editedValue ?? field.value);
              setEditing(true);
            }}
          >
            {side === 'front' ? t('card.editFront') : t('card.editBack')}
          </button>
        </>
      )}
    </div>
  );
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
  editState,
  onEdit,
  isEditable,
}: Readonly<CardFrameProps>) {
  const { t } = useTranslation('previews');
  const [showBack, setShowBack] = useState(false);
  const [frameHeight, setFrameHeight] = useState(DEFAULT_FRAME_HEIGHT);
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
  const editableSides = (['front', 'back'] as const).flatMap((side) => {
    const field = card.editable?.[side];
    return field ? [{ side, field }] : [];
  });

  useEffect(() => {
    let cancelled = false;
    const cardId = String(card.id);
    const html = showBack ? card.back : card.front;
    inlineApkgMedia(html, fetchMediaAsDataUrl, mediaCache).then((inlined) => {
      if (cancelled) return;
      const srcDoc = buildSrcDoc(inlined, card.css, cardId, isDark);
      setFrameDoc((prev) => ({ srcDoc, version: (prev?.version ?? 0) + 1 }));
    });
    return () => {
      cancelled = true;
    };
  }, [card, showBack, isDark]);

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

  function commitField(field: ApkgEditableField, draft: string) {
    const current = editState?.fields?.[field.fieldIndex] ?? field.value;
    if (onEdit == null || draft === current) return;
    onEdit(
      card.id,
      withFieldDraft(editState, field.fieldIndex, field.value, draft)
    );
  }

  function toggleDelete() {
    onEdit?.(card.id, { ...editState, deleted: !isDeleted });
  }

  function toggleSuspend() {
    onEdit?.(card.id, { ...editState, suspended: !isSuspended });
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
      {isEditable && editableSides.length > 0 && (
        <div className={styles.editPanel}>
          {editableSides.map(({ side, field }) => (
            <FieldEditor
              key={side}
              cardId={card.id}
              side={side}
              field={field}
              editedValue={editState?.fields?.[field.fieldIndex]}
              onCommit={(draft) => commitField(field, draft)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  NoteTypeStarter,
  deleteUserTemplate,
  downloadNoteTypeApkg,
  getDefaultNoteTypes,
  getOfficialNoteTypes,
  getUserTemplates,
} from '../../lib/backend/templates';
import { useDialog } from '../../lib/hooks/useDialog';
import sharedStyles from '../../styles/shared.module.css';
import DownloadIcon from '../../components/icons/DownloadIcon';
import EyeIcon from '../../components/icons/EyeIcon';
import PencilIcon from '../../components/icons/PencilIcon';
import TrashIcon from '../../components/icons/TrashIcon';
import styles from './TemplatesPage.module.css';
import { buildPreviewDocument } from './renderNoteTypePreview';

function safeFilename(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'note-type';
  return trimmed.replace(/[^A-Za-z0-9\-_ ]/g, '_');
}

async function triggerDownload(starter: NoteTypeStarter): Promise<void> {
  const blob = await downloadNoteTypeApkg(
    starter.noteType,
    starter.previewData
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilename(starter.name)}.apkg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

interface NoteTypeCardProps {
  starter: NoteTypeStarter;
  busy: boolean;
  ownedByUser: boolean;
  onDownload: (starter: NoteTypeStarter) => void;
  onPreview: (starter: NoteTypeStarter) => void;
  onDelete?: (starter: NoteTypeStarter) => void;
}

function NoteTypeCard({
  starter,
  busy,
  ownedByUser,
  onDownload,
  onPreview,
  onDelete,
}: Readonly<NoteTypeCardProps>) {
  const { t } = useTranslation('tools');
  const previewDoc = useMemo(
    () => buildPreviewDocument(starter.noteType, starter.previewData, 'front'),
    [starter]
  );
  const editHref = `/templates/edit/${encodeURIComponent(starter.id)}`;

  return (
    <article className={styles.card}>
      <div className={styles.previewWrap}>
        <iframe
          title={t('templates.previewTitle', { name: starter.name })}
          className={styles.previewFrame}
          sandbox="allow-scripts"
          srcDoc={previewDoc}
        />
      </div>
      <div className={styles.body}>
        <h2 className={styles.name} lang="en">
          <button
            type="button"
            className={styles.nameButton}
            onClick={() => onPreview(starter)}
          >
            {starter.name}
          </button>
        </h2>
        <p className={styles.description} lang="en">
          {starter.description}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.downloadBtn}
            onClick={() => onDownload(starter)}
            disabled={busy}
            aria-label={
              busy
                ? t('templates.preparingApkg')
                : t('templates.downloadAsApkg', { name: starter.name })
            }
          >
            <DownloadIcon width={14} height={14} />
            {busy ? t('templates.preparing') : t('templates.download')}
          </button>
          <button
            type="button"
            className={styles.previewBtn}
            onClick={() => onPreview(starter)}
            aria-label={t('templates.previewAria', { name: starter.name })}
          >
            <EyeIcon width={14} height={14} />
            {t('templates.preview')}
          </button>
          <div className={styles.secondaryActions}>
            <Link
              to={editHref}
              className={styles.ghostIconBtn}
              aria-label={
                ownedByUser
                  ? t('templates.editAria', { name: starter.name })
                  : t('templates.customizeAria', { name: starter.name })
              }
              title={
                ownedByUser ? t('templates.edit') : t('templates.customize')
              }
            >
              <PencilIcon width={16} height={16} />
            </Link>
            {ownedByUser && onDelete && (
              <button
                type="button"
                className={`${styles.ghostIconBtn} ${styles.ghostIconBtnDanger}`}
                onClick={() => onDelete(starter)}
                aria-label={t('templates.deleteAria', { name: starter.name })}
                title={t('templates.delete')}
              >
                <TrashIcon width={16} height={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

interface PreviewModalProps {
  starter: NoteTypeStarter;
  onClose: () => void;
}

function PreviewModal({ starter, onClose }: Readonly<PreviewModalProps>) {
  const { t } = useTranslation('tools');
  const frontDoc = useMemo(
    () => buildPreviewDocument(starter.noteType, starter.previewData, 'front'),
    [starter]
  );
  const backDoc = useMemo(
    () => buildPreviewDocument(starter.noteType, starter.previewData, 'back'),
    [starter]
  );
  const dialogRef = useDialog(true, onClose);

  return (
    <dialog
      ref={dialogRef}
      className={sharedStyles.dialog}
      aria-labelledby="note-type-preview-title"
    >
      <div className={`${sharedStyles.modalCard} ${styles.dialog}`}>
        <div className={sharedStyles.modalHeader}>
          <h2
            id="note-type-preview-title"
            className={sharedStyles.modalHeaderTitle}
          >
            {starter.name}
          </h2>
          <button
            type="button"
            className={sharedStyles.modalClose}
            onClick={onClose}
            aria-label={t('templates.close')}
          >
            &times;
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.modalSide}>
            <span className={styles.sideLabel}>{t('templates.front')}</span>
            <div className={styles.modalFrameWrap}>
              <iframe
                title={t('templates.frontPreview', { name: starter.name })}
                className={styles.modalFrame}
                sandbox="allow-scripts"
                srcDoc={frontDoc}
              />
            </div>
          </div>
          <div className={styles.modalSide}>
            <span className={styles.sideLabel}>{t('templates.back')}</span>
            <div className={styles.modalFrameWrap}>
              <iframe
                title={t('templates.backPreview', { name: starter.name })}
                className={styles.modalFrame}
                sandbox="allow-scripts"
                srcDoc={backDoc}
              />
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

export function TemplatesPage() {
  const { t } = useTranslation('tools');
  const [starters, setStarters] = useState<NoteTypeStarter[] | null>(null);
  const [userIds, setUserIds] = useState<Set<string>>(new Set());
  const [officialIds, setOfficialIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState<NoteTypeStarter | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    Promise.all([
      getDefaultNoteTypes(),
      getOfficialNoteTypes().catch(() => []),
      getUserTemplates().catch(() => ({ templates: [], hiddenIds: [] })),
    ])
      .then(([defaults, official, user]) => {
        if (cancelled) return;
        const hidden = new Set(user.hiddenIds);
        const officialIdSet = new Set(official.map((s) => s.id));
        const visibleDefaults = defaults.filter((s) => !hidden.has(s.id));
        const visibleOfficial = official.filter((s) => !hidden.has(s.id));
        const seen = new Set<string>();
        const merged: NoteTypeStarter[] = [];
        for (const item of [
          ...user.templates,
          ...visibleOfficial,
          ...visibleDefaults,
        ]) {
          if (!item?.id || seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }
        setStarters(merged);
        setOfficialIds(officialIdSet);
        setUserIds(new Set(user.templates.map((t) => t.id)));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : t('templates.couldNotLoad')
        );
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const ownedStarters = useMemo(
    () => (starters ?? []).filter((s) => userIds.has(s.id)),
    [starters, userIds]
  );
  const officialStarters = useMemo(
    () =>
      (starters ?? []).filter(
        (s) => !userIds.has(s.id) && officialIds.has(s.id)
      ),
    [starters, userIds, officialIds]
  );
  const defaultStarters = useMemo(
    () =>
      (starters ?? []).filter(
        (s) => !userIds.has(s.id) && !officialIds.has(s.id)
      ),
    [starters, userIds, officialIds]
  );

  const handleDelete = useCallback(
    async (starter: NoteTypeStarter) => {
      if (
        globalThis.window !== undefined &&
        !globalThis.confirm(
          t('templates.deleteConfirm', { name: starter.name })
        )
      ) {
        return;
      }
      try {
        await deleteUserTemplate(starter.id);
        setStarters((current) =>
          (current ?? []).filter((s) => s.id !== starter.id)
        );
        setUserIds((current) => {
          const next = new Set(current);
          next.delete(starter.id);
          return next;
        });
      } catch (error: unknown) {
        setDownloadError(
          error instanceof Error ? error.message : t('templates.couldNotDelete')
        );
      }
    },
    [t]
  );

  const handleDownload = useCallback(
    async (starter: NoteTypeStarter) => {
      setDownloadError(null);
      setBusyId(starter.id);
      try {
        await triggerDownload(starter);
      } catch (error: unknown) {
        setDownloadError(
          error instanceof Error
            ? error.message
            : t('templates.couldNotGenerate')
        );
      } finally {
        setBusyId(null);
      }
    },
    [t]
  );

  return (
    <div className={sharedStyles.page}>
      <Helmet>
        <title>{t('templates.pageTitle')} — 2anki</title>
      </Helmet>
      <header className={`${sharedStyles.pageHeader} ${styles.pageHeaderRow}`}>
        <div>
          <h1 className={sharedStyles.title}>{t('templates.heading')}</h1>
          <p className={sharedStyles.subtitle}>{t('templates.subtitle')}</p>
        </div>
        <Link
          to="/templates/new"
          className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
        >
          {t('templates.newNoteType')}
        </Link>
      </header>

      {loadError && (
        <div className={styles.error} role="alert">
          {t('templates.loadErrorPrefix')} {loadError}
        </div>
      )}
      {downloadError && (
        <div className={styles.error} role="alert">
          {downloadError}
        </div>
      )}

      {starters?.length === 0 && !loadError && (
        <div className={styles.emptyCard}>
          <p className={styles.emptyTitle}>{t('templates.emptyTitle')}</p>
          <p className={styles.emptyBody}>{t('templates.emptyBody')}</p>
          <div className={styles.emptyActions}>
            <Link
              to="/templates/new"
              className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
            >
              {t('templates.newNoteType')}
            </Link>
          </div>
        </div>
      )}

      {ownedStarters.length > 0 && (
        <section
          className={styles.section}
          aria-labelledby="your-note-types-heading"
        >
          <h2 id="your-note-types-heading" className={styles.sectionHeading}>
            {t('templates.yourNoteTypes')}
          </h2>
          <div className={styles.grid}>
            {ownedStarters.map((starter) => (
              <NoteTypeCard
                key={starter.id}
                starter={starter}
                ownedByUser
                busy={busyId === starter.id}
                onDownload={handleDownload}
                onPreview={setPreviewed}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}
      {defaultStarters.length > 0 && (
        <section
          className={styles.section}
          aria-labelledby="starter-note-types-heading"
        >
          <h2 id="starter-note-types-heading" className={styles.sectionHeading}>
            {t('templates.starterNoteTypes')}
          </h2>
          <div className={styles.grid}>
            {defaultStarters.map((starter) => (
              <NoteTypeCard
                key={starter.id}
                starter={starter}
                ownedByUser={false}
                busy={busyId === starter.id}
                onDownload={handleDownload}
                onPreview={setPreviewed}
              />
            ))}
          </div>
        </section>
      )}
      {officialStarters.length > 0 && (
        <section
          className={styles.section}
          aria-labelledby="official-note-types-heading"
        >
          <h2
            id="official-note-types-heading"
            className={styles.sectionHeading}
          >
            {t('templates.officialTemplates')}
          </h2>
          <div className={styles.grid}>
            {officialStarters.map((starter) => (
              <NoteTypeCard
                key={starter.id}
                starter={starter}
                ownedByUser={false}
                busy={busyId === starter.id}
                onDownload={handleDownload}
                onPreview={setPreviewed}
              />
            ))}
          </div>
        </section>
      )}

      {previewed && (
        <PreviewModal starter={previewed} onClose={() => setPreviewed(null)} />
      )}
    </div>
  );
}

export default TemplatesPage;

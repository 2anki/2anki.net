import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MindmapLimitModal } from './MindmapLimitModal';
import {
  useMindmapList,
  useCreateMindmap,
  useDeleteMindmap,
} from './useMindmap';
import shared from '../../styles/shared.module.css';
import styles from './MindmapList.module.css';
import TrashIcon from '../../components/icons/TrashIcon';

export function MindmapList() {
  const { t } = useTranslation('tools');
  const navigate = useNavigate();
  const { data, isLoading } = useMindmapList();
  const createMindmap = useCreateMindmap();
  const deleteMindmap = useDeleteMindmap();
  const [showLimitModal, setShowLimitModal] = useState(false);

  const atCap =
    data?.access != null &&
    !data.access.hasUnlimited &&
    data.access.currentCount >= data.access.freeMapLimit;

  const nearCap =
    data?.access != null &&
    !data.access.hasUnlimited &&
    data.access.currentCount >= data.access.freeMapLimit - 1;

  async function handleNewMap() {
    if (atCap) {
      setShowLimitModal(true);
      return;
    }
    const created = await createMindmap.mutateAsync(t('mindmaps.untitled'));
    if (created?.id != null) {
      navigate(`/mindmaps/${created.id}`);
    }
  }

  if (showLimitModal) {
    return (
      <MindmapLimitModal
        limit={data?.access.freeMapLimit ?? 3}
        onClose={() => setShowLimitModal(false)}
      />
    );
  }

  if (isLoading) {
    return (
      <div className={shared.page}>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('mindmaps.readingMaps')}
        </p>
      </div>
    );
  }

  return (
    <div className={shared.page}>
      <div
        className={shared.pageHeader}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className={shared.title}>{t('mindmaps.title')}</h1>
          <p className={shared.subtitle}>{t('mindmaps.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleNewMap}
          className={`${shared.btnPrimary} ${shared.btnInline}`}
        >
          {t('mindmaps.newMap')}
        </button>
      </div>

      {nearCap && !atCap && (
        <div
          className={shared.notificationInfo}
          style={{ marginBottom: '1rem' }}
        >
          {t('mindmaps.monthlyLimit', {
            limit: data?.access.freeMapLimit ?? 3,
          })}
        </div>
      )}

      {data?.maps.length === 0 && (
        <div className={shared.emptyState}>
          <p
            style={{
              marginBottom: '1rem',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {t('mindmaps.noMapsYet')}
          </p>
          <button
            type="button"
            onClick={handleNewMap}
            className={`${shared.btnOutline} ${shared.btnInline}`}
          >
            {t('mindmaps.newMap')}
          </button>
        </div>
      )}

      {(data?.maps ?? []).map((map) => {
        const displayTitle =
          map.title.length === 0 ? t('mindmaps.untitled') : map.title;
        return (
          <div key={map.id} className={styles.mapRow}>
            <button
              type="button"
              onClick={() => navigate(`/mindmaps/${map.id}`)}
              className={styles.mapOpen}
            >
              <span className={styles.mapTitle} title={map.title}>
                {displayTitle}
              </span>
            </button>
            <button
              type="button"
              aria-label={t('mindmaps.deleteAria', { title: displayTitle })}
              onClick={() => deleteMindmap.mutate(map.id)}
              className={styles.deleteBtn}
            >
              <TrashIcon width={16} height={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

import { Dispatch, SetStateAction, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorHandlerType } from '../../../../components/errors/helpers/getErrorMessage';
import DotsHorizontal from '../../../../components/icons/DotsHorizontal';
import EyeIcon from '../../../../components/icons/EyeIcon';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import { redirectToLogin } from '../../../../lib/backend/api';
import NotionObject from '../../../../lib/interfaces/NotionObject';
import { BlockIcon } from '../BlockIcon';
import styles from './SearchObjectEntry.module.css';

interface Props {
  isFavorite: boolean | undefined;
  title: string;
  icon: string | undefined;
  url: string;
  id: string;
  type: string;
  setFavorites: Dispatch<SetStateAction<NotionObject[]>>;
  setError: ErrorHandlerType;
}

type ConvertStatus =
  | 'idle'
  | 'queued'
  | 'in_progress'
  | 'paywall'
  | 'conflict'
  | 'error';

const getType = (data: string | { object: string }): string | null => {
  if (typeof data === 'object' && 'object' in data) {
    return data.object;
  }
  return typeof data === 'string' ? data : null;
};

function SearchObjectEntry(props: Readonly<Props>) {
  const { title, icon, url, id, type, setError } = props;
  const { t } = useTranslation('search');
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<ConvertStatus>('idle');
  const [restarted, setRestarted] = useState(false);

  const openRules = () => {
    const params = new URLSearchParams();
    params.set('title', title);
    const resolvedType = getType(type);
    if (resolvedType) params.set('type', resolvedType);
    const notionSearchReturn = new URLSearchParams({ q: title });
    params.set(
      'returnTo',
      `${location.pathname}?${notionSearchReturn.toString()}`
    );
    navigate(`/rules/${encodeURIComponent(id)}?${params.toString()}`);
  };

  const handleConvert = () => {
    if (status !== 'idle') return;
    setStatus('in_progress');
    get2ankiApi()
      .convert(id, getType(type), title)
      .then(async (response) => {
        if (response.status === 202) {
          const body = await response.json().catch(() => null);
          setRestarted(body?.restarted === true);
          setStatus('queued');
        } else if (response.status === 409) {
          setStatus('conflict');
        } else if (response.status === 402) {
          setStatus('paywall');
        } else if (response.status === 401) {
          setStatus('idle');
          redirectToLogin();
        } else {
          setStatus('error');
        }
      })
      .catch((error) => {
        setStatus('error');
        setError(error);
      });
  };

  const isConverting = status === 'in_progress';
  const isQueued = status === 'queued';

  return (
    <div className={styles.entry} data-hj-suppress>
      <div className={styles.objectMeta}>
        <BlockIcon icon={icon} />
        <span>{title}</span>
      </div>
      <div className={styles.objectActions}>
        {status === 'queued' && (
          <span className={styles.convertStatus}>
            {restarted ? t('entry.remaking') : t('entry.added')}
            <Link to="/downloads">{t('entry.view')}</Link>
          </span>
        )}
        {status === 'paywall' && (
          <span className={styles.convertStatus}>
            {t('entry.paywallText')}{' '}
            <Link to="/pricing">{t('entry.upgrade')}</Link>
            {t('entry.paywallSuffix')}
          </span>
        )}
        {status === 'conflict' && (
          <span className={styles.convertStatus}>{t('entry.conflict')}</span>
        )}
        {status === 'error' && (
          <span className={styles.convertStatus}>{t('entry.error')}</span>
        )}
        <button
          type="button"
          className={styles.convertBtn}
          onClick={handleConvert}
          disabled={isConverting || isQueued}
          aria-label={
            isConverting || isQueued
              ? t('entry.inProgress')
              : t('entry.convertToAnki')
          }
        >
          {isConverting || isQueued
            ? t('entry.inProgress')
            : t('entry.convert')}
        </button>
        <div className={styles.secondaryActions}>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={styles.iconLink}
            aria-label={t('entry.openInNotion', { title })}
            title={t('entry.openInNotion', { title })}
          >
            <img
              src="/icons/Notion_app_logo.png"
              alt=""
              width={20}
              height={20}
            />
          </a>
          <Link
            to={
              getType(type) === 'database'
                ? `/preview/database/${encodeURIComponent(id)}`
                : `/preview/${encodeURIComponent(id)}`
            }
            className={styles.iconLink}
            aria-label={t('entry.preview', { title })}
            title={t('entry.preview', { title })}
          >
            <EyeIcon width={20} height={20} />
          </Link>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={openRules}
            aria-label={t('entry.configureRules', { title })}
            title={t('entry.configureRules', { title })}
          >
            <DotsHorizontal width={20} height={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default SearchObjectEntry;

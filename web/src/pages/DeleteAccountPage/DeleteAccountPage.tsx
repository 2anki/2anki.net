import React from 'react';
import { useTranslation } from 'react-i18next';

import Cookies from 'universal-cookie';
import { forgetPendingUpload } from '../../lib/upload/pendingUpload';
import { redirectToFrontPage } from '../../lib/redirects';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import styles from '../AccountPage/AccountPage.module.css';
import sharedStyles from '../../styles/shared.module.css';

interface Prop {
  setError: ErrorHandlerType;
}

export function DeleteAccountPage({ setError }: Readonly<Prop>) {
  const { t } = useTranslation('accountx');
  const [count, setCount] = React.useState(0);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const deleteButtonText =
    count === 0 ? t('deleteAccount.delete') : t('deleteAccount.confirmDelete');

  const handleDelete = async () => {
    if (count < 1) {
      setCount(count + 1);
      return;
    }

    setIsDeleting(true);
    try {
      await get2ankiApi().deleteAccount(count === 2);
      localStorage.clear();
      sessionStorage.clear();
      await forgetPendingUpload();
      new Cookies().remove('token');
      redirectToFrontPage();
    } catch (error) {
      setError(error);
      setIsDeleting(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={sharedStyles.pageHeader}>
        <h1 className={sharedStyles.title}>{t('deleteAccount.title')}</h1>
        <p className={sharedStyles.subtitle}>{t('deleteAccount.subtitle')}</p>
      </header>
      <div className={styles.mainCard}>
        <p
          className={`${sharedStyles.smallDescription} ${sharedStyles.marginBottomLg}`}
        >
          {t('deleteAccount.confirmQuestion')}
        </p>

        {isDeleting && (
          <div className={sharedStyles.infoBox} role="status">
            {t('deleteAccount.deleting')}
          </div>
        )}

        <button
          onClick={handleDelete}
          className={styles.dangerButton}
          type="button"
          disabled={isDeleting}
        >
          {isDeleting ? t('deleteAccount.deletingShort') : deleteButtonText}
        </button>
        <p
          className={`${sharedStyles.smallDescription} ${sharedStyles.marginTopLg}`}
        >
          {t('deleteAccount.disconnectPrefix')}
          <a
            href="https://www.notion.so/help/add-and-manage-integrations-with-the-api"
            target="_blank"
            rel="noreferrer"
          >
            {t('deleteAccount.disconnectLink')}
          </a>
          .
        </p>
      </div>
    </div>
  );
}

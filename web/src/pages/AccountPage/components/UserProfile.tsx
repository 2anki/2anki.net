import { useTranslation } from 'react-i18next';
import styles from '../AccountPage.module.css';
import { ChangeEmail } from './ChangeEmail';

interface User {
  name: string;
  email: string;
}

interface UserProfileProps {
  readonly user: User;
}

export function UserProfile({ user }: UserProfileProps) {
  const { t } = useTranslation('accountx');
  const isPrivateRelay = user.email.endsWith('@privaterelay.appleid.com');

  return (
    <>
      <section className={styles.section}>
        <p className={styles.name} data-hj-suppress>
          {user.name}
        </p>
        <p className={styles.email} data-hj-suppress>
          {user.email}
        </p>
        {isPrivateRelay && (
          <p className={styles.privacyNote}>{t('profile.hideMyEmailNote')}</p>
        )}
      </section>
      <ChangeEmail />
    </>
  );
}

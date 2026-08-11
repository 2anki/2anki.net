import { useTranslation } from 'react-i18next';
import NavbarItem from '../NavbarItem';
import { ThemeToggle } from '../../ThemeSwitcher/ThemeToggle';
import { LanguagePicker } from '../../LanguagePicker/LanguagePicker';
import styles from '../NavigationBar.module.css';

interface RightSideProps {
  path: string;
  isLoggedIn: boolean;
}

export function RightSide({ path, isLoggedIn }: Readonly<RightSideProps>) {
  const { t } = useTranslation();
  return (
    <div className={styles.navEnd}>
      <NavbarItem href="/upload" path={path}>
        {t('nav.upload')}
      </NavbarItem>
      <NavbarItem href="/print" path={path}>
        {t('nav.print')}
      </NavbarItem>
      <NavbarItem href="/documentation" path={path}>
        {t('nav.docs')}
      </NavbarItem>
      {isLoggedIn && (
        <NavbarItem href="/pricing" path={path}>
          {t('nav.pricing')}
        </NavbarItem>
      )}
      {!isLoggedIn && (
        <NavbarItem href="/app" path={path}>
          {t('nav.download')}
        </NavbarItem>
      )}
      <NavbarItem href="/login#login" path={path}>
        {t('nav.login')}
      </NavbarItem>
      <LanguagePicker />
      <ThemeToggle />
    </div>
  );
}

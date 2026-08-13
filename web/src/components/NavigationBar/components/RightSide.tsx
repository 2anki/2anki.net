import { useTranslation } from 'react-i18next';
import NavbarItem from '../NavbarItem';
import { ThemeToggle } from '../../ThemeSwitcher/ThemeToggle';
import { LanguagePicker } from '../../LanguagePicker/LanguagePicker';
import styles from '../NavigationBar.module.css';

export type NavbarVariant = 'current' | 'quiet' | 'oneCta' | 'convertOrSignIn';

interface RightSideProps {
  path: string;
  isLoggedIn: boolean;
  variant?: NavbarVariant;
}

function utilityGroupClassFor(variant: NavbarVariant): string {
  if (variant === 'oneCta') return styles.utilityGroupDivided;
  if (variant === 'convertOrSignIn') return styles.utilityGroupSegmented;
  return styles.utilityGroup;
}

interface VariantRightSideProps {
  path: string;
  variant: Exclude<NavbarVariant, 'current'>;
}

function VariantRightSide({ path, variant }: Readonly<VariantRightSideProps>) {
  const { t } = useTranslation();
  return (
    <div className={styles.navEnd}>
      <NavbarItem href="/print" path={path}>
        {t('nav.print')}
      </NavbarItem>
      <NavbarItem href="/documentation" path={path}>
        {t('nav.docs')}
      </NavbarItem>
      <NavbarItem href="/app" path={path}>
        {t('nav.download')}
      </NavbarItem>
      {variant === 'convertOrSignIn' ? (
        <a href="/login#login" className={styles.navLogin}>
          {t('nav.login')}
        </a>
      ) : (
        <NavbarItem href="/login#login" path={path}>
          {t('nav.login')}
        </NavbarItem>
      )}
      <a href="/upload" className={styles.navCta}>
        {t('nav.upload')}
      </a>
      <div className={utilityGroupClassFor(variant)}>
        <LanguagePicker variant={variant === 'oneCta' ? 'bareIcon' : 'bare'} />
        <ThemeToggle />
      </div>
    </div>
  );
}

export function RightSide({
  path,
  isLoggedIn,
  variant = 'current',
}: Readonly<RightSideProps>) {
  const { t } = useTranslation();
  if (variant !== 'current') {
    return <VariantRightSide path={path} variant={variant} />;
  }
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

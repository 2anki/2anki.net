import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../lib/hooks/useTheme';
import styles from './NavigationBar.module.css';
import { RightSide, type NavbarVariant } from './components/RightSide';

interface NavigationBarProps {
  isLoggedIn: boolean | undefined;
  variant?: NavbarVariant;
}

function NavigationBar({
  isLoggedIn,
  variant = 'current',
}: Readonly<NavigationBarProps>) {
  const { t } = useTranslation('chrome');
  const [active, setActive] = useState(false);
  const path = globalThis.location.pathname;
  const theme = useTheme();
  const isLight = theme === 'light';
  const logoSrc = isLight ? '/mascot/navbar-logo.png' : '/mascot/Notion 1.png';
  const logoWidth = isLight ? 103 : 33;

  const isResolved = isLoggedIn !== undefined;

  return (
    <nav className={styles.navbar} aria-label={t('nav.mainNavigation')}>
      <div className={styles.brand}>
        <a className={styles.logoLink} href="/">
          <img
            src={logoSrc}
            alt={t('nav.logoAlt')}
            width={logoWidth}
            height={28}
            fetchPriority="high"
          />
        </a>
        <button
          type="button"
          className={styles.burger}
          aria-label={t('nav.menu')}
          aria-expanded={active}
          onClick={() => setActive(!active)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      </div>

      <div className={active ? styles.menuActive : styles.menu}>
        {isResolved && (
          <RightSide path={path} isLoggedIn={isLoggedIn} variant={variant} />
        )}
      </div>
    </nav>
  );
}

export default NavigationBar;

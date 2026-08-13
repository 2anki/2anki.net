import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../lib/hooks/useTheme';
import styles from './NavigationBar.module.css';
import { NavActions, NavLinks, RightSide } from './components/RightSide';

export type NavbarVariant = 'current' | 'groupedLeft' | 'centered' | 'deck';

interface NavigationBarProps {
  isLoggedIn: boolean | undefined;
  variant?: NavbarVariant;
}

function navbarClassFor(variant: NavbarVariant): string {
  if (variant === 'deck') return `${styles.navbar} ${styles.navbarDeck}`;
  return styles.navbar;
}

function menuVariantClassFor(variant: NavbarVariant): string {
  if (variant === 'current') return '';
  if (variant === 'deck') return `${styles.menuVariant} ${styles.menuDeck}`;
  return styles.menuVariant;
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
  const menuClass =
    `${active ? styles.menuActive : styles.menu} ${menuVariantClassFor(variant)}`.trim();

  return (
    <nav
      className={navbarClassFor(variant)}
      aria-label={t('nav.mainNavigation')}
    >
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

      <div className={menuClass}>
        {isResolved && variant === 'current' && (
          <RightSide path={path} isLoggedIn={isLoggedIn} />
        )}
        {isResolved && variant !== 'current' && (
          <>
            <div
              className={
                variant === 'centered'
                  ? styles.linksSlotCentered
                  : styles.linksSlot
              }
            >
              <NavLinks path={path} />
            </div>
            <div className={styles.actionsSlot}>
              <NavActions
                path={path}
                ctaClass={variant === 'deck' ? styles.navCtaDeck : undefined}
              />
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

export default NavigationBar;

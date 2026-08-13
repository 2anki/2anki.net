import { useState } from 'react';

import NavigationBar from '../../components/NavigationBar/NavigationBar';
import type { NavbarVariant } from '../../components/NavigationBar/components/RightSide';
import sharedStyles from '../../styles/shared.module.css';
import styles from './NavbarPreviewPage.module.css';

/**
 * Anonymous-navbar redesign candidates rendered against the real components.
 * The designer's fixed decisions across all variants: the one accent moves to
 * Make flashcards, Download drops to a muted link, the language pill loses its
 * fill. The variants differ on Log in's weight and how the two utility icons
 * are grouped. The CTA's resting background is --color-primary-hover because
 * --color-primary fails WCAG AA for white text on light, purple, and hotpink.
 */

const THEMES = ['light', 'dark', 'gold', 'purple', 'hotpink'] as const;

const VARIANTS: ReadonlyArray<{
  variant: NavbarVariant;
  title: string;
  note: string;
}> = [
  {
    variant: 'current',
    title: 'Current',
    note: 'What ships today — seven items, four treatments, the accent on Download, the language pill heaviest.',
  },
  {
    variant: 'quiet',
    title: 'A — Quiet utilities',
    note: 'Smallest change. Log in stays a text link; utilities drop to quiet icons (globe keeps a 2-letter code); one filled CTA.',
  },
  {
    variant: 'oneCta',
    title: 'B — One CTA',
    note: 'Maximum restraint. Everything is a whisper except the CTA; utilities are icon-only behind a hairline divider.',
  },
  {
    variant: 'convertOrSignIn',
    title: 'C — Refined (single focal point)',
    note: 'One filled container only: Log in demoted to a text link beside the CTA, a 32px gap splits destinations from actions, links sit one contrast step brighter, and the utilities are independent quiet icons — the language switcher gains a ▾ dropdown cue.',
  },
];

export default function NavbarPreviewPage() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>('light');

  return (
    <div className={styles.page} data-theme={theme}>
      <header className={styles.header}>
        <h1 className={sharedStyles.title}>Navbar preview — anonymous</h1>
        <p className={styles.lead}>
          Pick a theme, compare the bars. The mascot logo follows the app-level
          theme toggle, not this selector — judge the right-hand cluster, not
          the logo.
        </p>
        <div className={styles.themeRow}>
          {THEMES.map((name) => (
            <button
              key={name}
              type="button"
              className={
                name === theme ? styles.themeButtonActive : styles.themeButton
              }
              onClick={() => setTheme(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </header>

      {VARIANTS.map(({ variant, title, note }) => (
        <section key={variant} className={styles.variantSection}>
          <h2 className={styles.variantTitle}>{title}</h2>
          <p className={styles.variantNote}>{note}</p>
          <div className={styles.frame}>
            <NavigationBar isLoggedIn={false} variant={variant} />
          </div>
        </section>
      ))}
    </div>
  );
}

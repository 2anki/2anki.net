import { useState } from 'react';

import NavigationBar, {
  type NavbarVariant,
} from '../../components/NavigationBar/NavigationBar';
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
    variant: 'groupedLeft',
    title: 'A — Grouped left',
    note: 'Links move next to the logo, the way Stripe and Linear set their marketing chrome. The whole right side becomes the action zone: Log in, the one filled CTA, quiet utilities.',
  },
  {
    variant: 'centered',
    title: 'B — Center stage',
    note: 'Links sit dead-center between the brand and the actions — a balanced, editorial bar where the CTA owns the right edge alone.',
  },
  {
    variant: 'deck',
    title: 'C — Deck on the desk',
    note: 'The bar takes a soft gray surface and the CTA becomes a stacked flashcard — a white card edge peeks out beneath it and the stack presses down on hover. The one signature move, grounded in what 2anki makes.',
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

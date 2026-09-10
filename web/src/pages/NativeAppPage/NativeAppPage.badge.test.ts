import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The two App Store badges are theme variants; exactly one may render. Vitest
// does not apply CSS modules, so this locks the stylesheet's selector
// specificity instead: a bare `.badge img` rule that sets `display` outranks
// `.badgeDark { display: none }` and shows both badges side by side.
const css = readFileSync(
  resolve(__dirname, 'NativeAppPage.module.css'),
  'utf8'
).replaceAll(/\/\*[\s\S]*?\*\//g, '');

const ruleBodies = (selector: string): string[] =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sel]) => sel.trim() === selector)
    .map(([, , body]) => body);

describe('NativeAppPage badge stylesheet', () => {
  it('does not set display on the shared .badge img rule', () => {
    const bodies = ruleBodies('.badge img');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/display\s*:/);
  });

  it('hides the dark badge with a selector at least as specific as the light one', () => {
    expect(ruleBodies('.badge .badgeDark')[0]).toMatch(/display\s*:\s*none/);
    expect(ruleBodies('.badge .badgeLight')[0]).toMatch(/display\s*:\s*block/);
  });

  it('swaps the badges under the dark theme', () => {
    expect(ruleBodies("[data-theme='dark'] .badge .badgeLight")[0]).toMatch(
      /display\s*:\s*none/
    );
    expect(ruleBodies("[data-theme='dark'] .badge .badgeDark")[0]).toMatch(
      /display\s*:\s*block/
    );
  });
});

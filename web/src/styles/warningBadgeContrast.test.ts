import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseCss = readFileSync(join(__dirname, 'base.css'), 'utf8');
const sharedCss = readFileSync(join(__dirname, 'shared.module.css'), 'utf8');

function themeBlocks(css: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  const pattern = /(:root|\[data-theme='[^']+'\])[^{]*\{([^}]*)\}/g;
  for (const match of css.matchAll(pattern)) {
    const name = match[1] === ':root' ? 'light' : match[1];
    blocks[name] = (blocks[name] ?? '') + match[2];
  }
  return blocks;
}

function readVar(block: string, name: string): string | null {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  return match ? match[1] : null;
}

function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe('warning badge contrast (issue #4011)', () => {
  it('badgeWarning paints text with the tuned warning-text token, not the raw accent', () => {
    const badge = /\.badgeWarning\s*\{[^}]*\}/.exec(sharedCss)?.[0] ?? '';
    expect(badge).toContain('color: var(--color-warning-text)');
    expect(badge).not.toContain('color: var(--color-warning)');
  });

  it('warning-text on warning-light clears WCAG AA (4.5:1) in every theme', () => {
    const blocks = themeBlocks(baseCss);
    const themed = Object.entries(blocks).filter(
      ([, block]) =>
        readVar(block, '--color-warning-text') &&
        readVar(block, '--color-warning-light')
    );
    expect(themed.length).toBeGreaterThanOrEqual(5);
    for (const [name, block] of themed) {
      const text = readVar(block, '--color-warning-text') as string;
      const bg = readVar(block, '--color-warning-light') as string;
      const ratio = contrastRatio(text, bg);
      expect(
        ratio,
        `${name}: ${text} on ${bg} = ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

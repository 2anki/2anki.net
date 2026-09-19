import { afterAll, describe, expect, it } from 'vitest';

import i18n from '../../lib/i18n';

afterAll(async () => {
  await i18n.changeLanguage('en');
});

type Case = [count: number, nounForm: string];

const PL_MAP_CASES: Case[] = [
  [1, 'mapę myśli'],
  [2, 'mapy myśli'],
  [3, 'mapy myśli'],
  [5, 'map myśli'],
  [21, 'map myśli'],
];

const PL_NODE_CASES: Case[] = [
  [1, 'węzeł'],
  [2, 'węzły'],
  [3, 'węzły'],
  [5, 'węzłów'],
  [21, 'węzłów'],
];

const RU_MAP_CASES: Case[] = [
  [1, 'ментальную карту'],
  [2, 'ментальные карты'],
  [3, 'ментальные карты'],
  [5, 'ментальных карт'],
  [21, 'ментальную карту'],
];

const RU_NODE_CASES: Case[] = [
  [1, 'узел'],
  [2, 'узла'],
  [3, 'узла'],
  [5, 'узлов'],
  [21, 'узел'],
];

function resolve(key: string, count: number): string {
  return i18n.t(`tools:mindmaps.${key}`, { count });
}

describe('Polish mind-map limit plurals', () => {
  it.each(PL_MAP_CASES)(
    'limitSubheading agrees for count %i',
    async (count, nounForm) => {
      await i18n.changeLanguage('pl');
      expect(resolve('limitSubheading', count)).toContain(nounForm);
    }
  );

  it.each(PL_MAP_CASES)(
    'monthlyLimit agrees for count %i',
    async (count, nounForm) => {
      await i18n.changeLanguage('pl');
      expect(resolve('monthlyLimit', count)).toContain(nounForm);
    }
  );

  it.each(PL_NODE_CASES)(
    'nodeLimitReached agrees for count %i',
    async (count, nounForm) => {
      await i18n.changeLanguage('pl');
      expect(resolve('nodeLimitReached', count)).toContain(nounForm);
    }
  );
});

describe('Russian mind-map limit plurals', () => {
  it.each(RU_MAP_CASES)(
    'limitSubheading agrees for count %i',
    async (count, nounForm) => {
      await i18n.changeLanguage('ru');
      expect(resolve('limitSubheading', count)).toContain(nounForm);
    }
  );

  it.each(RU_MAP_CASES)(
    'monthlyLimit agrees for count %i',
    async (count, nounForm) => {
      await i18n.changeLanguage('ru');
      expect(resolve('monthlyLimit', count)).toContain(nounForm);
    }
  );

  it.each(RU_NODE_CASES)(
    'nodeLimitReached agrees for count %i',
    async (count, nounForm) => {
      await i18n.changeLanguage('ru');
      expect(resolve('nodeLimitReached', count)).toContain(nounForm);
    }
  );
});

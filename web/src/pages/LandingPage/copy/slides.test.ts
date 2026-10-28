import { describe, expect, it } from 'vitest';

import de from '../../../lib/i18n/locales/de/landing.json';
import en from '../../../lib/i18n/locales/en/landing.json';
import es from '../../../lib/i18n/locales/es/landing.json';
import fr from '../../../lib/i18n/locales/fr/landing.json';
import it_ from '../../../lib/i18n/locales/it/landing.json';
import ja from '../../../lib/i18n/locales/ja/landing.json';
import nl from '../../../lib/i18n/locales/nl/landing.json';
import pl from '../../../lib/i18n/locales/pl/landing.json';
import pt from '../../../lib/i18n/locales/pt/landing.json';
import ru from '../../../lib/i18n/locales/ru/landing.json';
import type { LandingCopy } from '../types';
import medicalLectureSlidesCopy from './medical-lecture-slides';
import nursingCopy from './nursing';
import usmleCopy from './usmle';

function everyClaim(copy: LandingCopy): string[] {
  return [
    copy.description,
    copy.subhead,
    ...(copy.whatComesAcross ?? []).flatMap((item) => [item.title, item.body]),
    ...copy.faqs.map((faq) => faq.a),
  ];
}

function whatComesAcross(copy: LandingCopy, title: string): string {
  const item = (copy.whatComesAcross ?? []).find((i) => i.title === title);
  expect(item).toBeDefined();
  return item?.body ?? '';
}

describe('slide PDF landing copy describes the cards a slide PDF makes', () => {
  it('says each slide title fronts a card with its bullets on the back', () => {
    expect(medicalLectureSlidesCopy.subhead).toBe(
      'Upload a PDF of your slides — each slide becomes a card, with the slide title on the front and its bullets on the back.'
    );
  });

  it.each([medicalLectureSlidesCopy, usmleCopy, nursingCopy])(
    '$pathname no longer says headings become decks or bullets become nested cards',
    (copy) => {
      expect(
        everyClaim(copy).filter((text) =>
          /deck names|bullets become cards|nested cards/i.test(text)
        )
      ).toEqual([]);
    }
  );

  it.each([medicalLectureSlidesCopy, usmleCopy, nursingCopy])(
    '$pathname says nested bullets stay on the back of their card',
    (copy) => {
      expect(whatComesAcross(copy, 'Nested lists')).toContain(
        'stay on the back of'
      );
    }
  );

  it.each([medicalLectureSlidesCopy, usmleCopy])(
    '$pathname does not promise PDF bold and italic carry through',
    (copy) => {
      expect(
        (copy.whatComesAcross ?? []).map((item) => item.title)
      ).not.toContain('Bold and italic text');
    }
  );
});

describe('slide PDF landing subhead in every locale', () => {
  const locales = { de, en, es, fr, it: it_, ja, nl, pl, pt, ru };

  it('matches the English copy in en', () => {
    expect(en.pages['anki-from-medical-lecture-slides'].subhead).toBe(
      medicalLectureSlidesCopy.subhead
    );
  });

  it.each(Object.entries(locales))(
    '%s drops the headings-become-deck-names claim',
    (_lang, landing) => {
      expect(
        landing.pages['anki-from-medical-lecture-slides'].subhead
      ).not.toMatch(
        /deck names|Stapelnamen|decknamen|nombres de mazo|noms de paquets|デッキ名|nomi dei mazzi|nazwami talii|nomes de baralho|названиями колод/i
      );
    }
  );
});

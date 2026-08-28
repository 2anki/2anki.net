import { describe, expect, it } from 'vitest';

import enAccount from '../en/account.json';
import enAnkify from '../en/ankify.json';
import enChat from '../en/chat.json';
import enCommon from '../en/common.json';
import enErrors from '../en/errors.json';
import enLanding from '../en/landing.json';
import enMarketing from '../en/marketing.json';
import enSearch from '../en/search.json';
import enTools from '../en/tools.json';
import itAccount from './account.json';
import itAnkify from './ankify.json';
import itChat from './chat.json';
import itCommon from './common.json';
import itErrors from './errors.json';
import itLanding from './landing.json';
import itMarketing from './marketing.json';
import itSearch from './search.json';
import itTools from './tools.json';

type Json = Record<string, unknown>;

const namespaces: Record<string, { en: Json; it: Json }> = {
  account: { en: enAccount, it: itAccount },
  ankify: { en: enAnkify, it: itAnkify },
  chat: { en: enChat, it: itChat },
  common: { en: enCommon, it: itCommon },
  errors: { en: enErrors, it: itErrors },
  landing: { en: enLanding, it: itLanding },
  marketing: { en: enMarketing, it: itMarketing },
  search: { en: enSearch, it: itSearch },
  tools: { en: enTools, it: itTools },
};

function flatten(value: Json, prefix = '', out: Record<string, string> = {}) {
  for (const [key, raw] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (raw && typeof raw === 'object') {
      flatten(raw as Json, path, out);
    } else {
      out[path] = String(raw);
    }
  }
  return out;
}

function placeholders(text: string): string[] {
  return (text.match(/\{\{\s*[^}]+\s*\}\}/g) ?? []).sort();
}

const allowedIdentical = new Set<string>([
  'account:subscription.premium',
  'account:subscription.pastDueTitle',
  'account:subscription.pastDueBody',
  'account:subscription.pastDueBodyNoPlan',
  'account:subscription.endedPaymentFailed',
  'account:subscription.statusLoadFailed',
  'account:planDetails.free',
  'ankify:subscriptions.inAnki',
  'ankify:workspace.backLink',
  'ankify:stats.months.feb',
  'ankify:stats.months.mar',
  'ankify:stats.months.apr',
  'ankify:stats.months.nov',
  'ankify:page.reviewTrackerFallback',
  'common:nav.chat',
  'common:nav.autoSync',
  'common:home.features.chat.label',
  'common:home.features.autoSync.label',
  'common:nav.account',
  'common:nav.privacy',
  'common:account.title',
  'common:language.english',
  'common:language.german',
  'common:auth.common.email',
  'common:auth.common.password',
  'common:pricing.features.notionToAnkiTitle',
  'common:pricing.features.ankiToNotionTitle',
  'common:downloads.source.notion',
  'common:downloads.source.dropbox',
  'common:downloads.source.drive',
  'common:modals.producer.team2to10',
  'common:modals.producer.team11to50',
  'common:cardOptions.groups.media',
  'common:cardOptions.mcq.off',
  'common:cardOptions.mcq.on',
  'common:cardOptions.mcq.introSuffix',
  'common:cardOptions.mcq.extra',
  'common:cardOptions.overlappingCloze.off',
  'common:cardOptions.cardStyle.cloze',
  'common:cardOptions.audio.heading',
  'common:cardOptions.templates.introSuffix',
  'marketing:about.philosophySuffix',
  'marketing:status.api',
  'marketing:status.database',
  'marketing:contact.errorSuffix',
  'marketing:contact.emailLabel',
  'search:page.titleConnected',
  'search:results.scopeWorkspace',
  'search:results.emptyBodySuffix',
  'tools:occlusion.noPagesMatchPost',
  'tools:rules.labelToggle',
]);

describe('Italian locale', () => {
  for (const [name, { en, it: itLocale }] of Object.entries(namespaces)) {
    const enFlat = flatten(en);
    const itFlat = flatten(itLocale);

    it(`${name}: has the same keys as English`, () => {
      expect(Object.keys(itFlat).sort()).toEqual(Object.keys(enFlat).sort());
    });

    it(`${name}: preserves interpolation placeholders`, () => {
      for (const key of Object.keys(enFlat)) {
        expect(placeholders(itFlat[key])).toEqual(placeholders(enFlat[key]));
      }
    });

    it(`${name}: translates every value except protected strings`, () => {
      const untranslated = Object.keys(enFlat).filter(
        (key) =>
          enFlat[key] === itFlat[key] && !allowedIdentical.has(`${name}:${key}`)
      );
      expect(untranslated).toEqual([]);
    });
  }
});

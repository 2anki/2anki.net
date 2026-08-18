import type { LandingStep } from './types';

export const DEFAULT_LANDING_STEPS: ReadonlyArray<LandingStep> = [
  {
    title: 'Drop your file',
    body: 'Notion export, PDF, Word, Markdown, or a Quizlet export.',
  },
  {
    title: '2anki builds your deck',
    body: 'Usually a few seconds. Bigger files take a minute.',
  },
  {
    title: 'Open it in Anki',
    body: 'Double-click the .apkg file. Your cards are ready to study.',
  },
];

export const DEFAULT_LANDING_FORMATS: ReadonlyArray<string> = [
  'Notion',
  'PDF',
  'Markdown',
  'HTML',
  'CSV',
  'Word',
  'Quizlet',
];

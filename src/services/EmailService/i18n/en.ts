import { EmailStrings } from './types';

export const en: EmailStrings = {
  resetPassword: {
    subject: 'Reset your 2anki.net password',
    heading: 'Reset your password',
    body: 'Reset your 2anki.net password using the button below.',
    cta: 'Reset password',
    disclaimer:
      'Did not request this? Ignore this message. Your password remains unchanged.',
    text: 'We received your password change request, you can change it here {{link}}',
  },
  magicLinkLogin: {
    subject: 'Your 2anki login link',
    heading: 'Sign in to 2anki.net',
    description: 'Click the button below to sign in to your account.',
    cta: 'Sign in',
    text: 'Sign in to your 2anki account using this link: {{link}}',
  },
  magicLinkReset: {
    subject: 'Reset your 2anki password',
    heading: 'Reset your 2anki.net password',
    description: 'Click the button below to reset your password.',
    cta: 'Reset password',
    text: 'Reset your 2anki password using this link: {{link}}',
  },
  magicLinkShared: {
    expiry: 'This link expires in 15 minutes.',
    disclaimer:
      'Did not request this? Ignore this message. No changes will be made to your account.',
  },
  deckReady: {
    subject: '2anki.net - Your «{{filename}}» deck is ready',
    heading: 'Your deck is ready',
    bodyAttached:
      'Your converted deck is attached to this email. Import it into Anki to start studying.',
    bodyTrouble: 'Having trouble? Reply to this email.',
    disclaimerPrefix: 'Did not request this conversion? Contact us at ',
    disclaimerSuffix: '.',
    cardSingular: 'card',
    cardPlural: 'cards',
    textReadyPrefix: 'Your deck is ready: ',
    textAttached: '. It is attached to this email.',
  },
  reEngagement: {
    subject: 'Still making cards by hand?',
    title: '2anki.net - Still making cards by hand?',
    heading: 'Still making cards by hand?',
    body: "Hi {{name}}, you signed up for 2anki a few days ago but haven't made a deck yet. Typing out flashcards is the slow part — 2anki turns a Notion page or an uploaded file into an Anki deck in under a minute.",
    videoCaption: 'Watch how it works (60 sec)',
    bodyPaste:
      'Paste a Notion page URL or upload a file at 2anki.net to try it.',
    bodyReply:
      'Stuck on something? Reply to this email — Alexander reads every one.',
    cta: 'Tell us what happened',
    text: "Hi {{name}},\n\nYou signed up for 2anki a few days ago but haven't made a deck yet. Typing out flashcards is the slow part — 2anki turns a Notion page or an uploaded file into an Anki deck in under a minute.\n\nPaste a Notion page URL or upload a file at https://2anki.net to try it.\n\nStuck on something? Reply to this email — Alexander reads every one.\n\nTell us what happened: {{surveyUrl}}\n\nThe 2anki Team",
  },
  inactivityWarning: {
    subject: 'Your decks on 2anki — still here when you need them',
    title: '2anki.net — Your decks, still here when you need them',
    bodyWithConversion:
      "Your last deck on 2anki was {{deckName}}. If another exam or chapter is coming up, your account is ready — paste a Notion link or drop in a file and you'll have a deck in under a minute.",
    bodyNoConversion:
      "You signed up for 2anki but haven't made a deck yet. When you're ready, paste a Notion link or drop in a file at 2anki.net and you'll have an Anki deck in under a minute.",
    passLine:
      'If you only need it for one push — a Day Pass covers a full day of converting, a Week Pass covers a week. Pay once, no subscription.',
    cta: 'Open 2anki',
    housekeeping:
      "One housekeeping note: accounts inactive for 6 months get cleaned up, and we'll remove your uploaded decks and files in 14 days if we don't see you. Anything already downloaded to Anki is safe. Signing in once keeps everything.",
    signoff: 'The 2anki Team',
  },
  abandonedCheckout: {
    subject: 'Finish your 2anki Pro subscription',
    title: '2anki.net — Finish your Pro subscription',
    bodyStarted:
      "You started a 2anki Pro subscription and didn't finish checkout.",
    bodySnag:
      'Most people who stop here hit a snag at payment, not a change of mind. If something broke or you have a question, reply to this email — Alexander reads every one.',
    cta: 'Finish signing up',
    signoff: 'The 2anki Team',
  },
  commercialShared: {
    unsubscribe: "Don't want emails like this? Unsubscribe",
  },
};

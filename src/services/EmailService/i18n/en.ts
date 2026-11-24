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
    subject: 'Your «{{filename}}» deck is ready',
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
    title: 'Still making cards by hand?',
    heading: 'Still making cards by hand?',
    body: "Hi {{name}}, you signed up for 2anki a few days ago but haven't made a deck yet. Typing out flashcards is the slow part. 2anki turns a Notion page or an uploaded file into an Anki deck in under a minute.",
    videoCaption: 'Watch how it works (60 sec)',
    bodyPaste:
      'Paste a Notion page URL or upload a file at 2anki.net to try it.',
    bodyReply:
      'Stuck on something? Reply to this email. Alexander reads every one.',
    cta: 'Tell us what happened',
    text: "Hi {{name}},\n\nYou signed up for 2anki a few days ago but haven't made a deck yet. Typing out flashcards is the slow part. 2anki turns a Notion page or an uploaded file into an Anki deck in under a minute.\n\nPaste a Notion page URL or upload a file at https://2anki.net to try it.\n\nStuck on something? Reply to this email. Alexander reads every one.\n\nTell us what happened: {{surveyUrl}}\n\nThe 2anki Team",
  },
  inactivityWarning: {
    subjectWithConversion: 'Your decks on 2anki are still here',
    subjectNoConversion: 'Your 2anki account is still here',
    bodyWithConversion:
      "Your last deck on 2anki was {{deckName}}. Another exam or chapter coming up? Your account is ready. Paste a Notion link or drop a file and you'll have a deck in under a minute.",
    bodyNoConversion:
      "You signed up for 2anki but haven't made a deck yet. When you're ready, paste a Notion link or drop a file at 2anki.net. You'll have an Anki deck in under a minute.",
    passLine:
      'Only need it for one push? A Day Pass covers a full day of converting and a Week Pass covers a week. Pay once, no subscription.',
    cta: 'Open 2anki',
    housekeeping:
      "We clean up accounts that have been inactive for 6 months. If you don't sign in within 14 days, we'll remove your uploaded decks and files. Anything already downloaded to Anki is safe. Signing in once keeps everything.",
    signoff: 'The 2anki Team',
  },
  abandonedCheckout: {
    subject: "You didn't finish checking out on 2anki",
    title: "You didn't finish checking out",
    bodyStarted:
      "You started checking out on 2anki and didn't finish. You weren't charged for this checkout, and it didn't start a subscription or a pass.",
    bodySnag:
      'Most people who stop here hit a snag at payment, not a change of mind. If something broke or you have a question, reply to this email. Alexander reads every one.',
    cta: 'Return to checkout',
    signoff: 'The 2anki Team',
  },
  passEnding: {
    subject: 'Your {{passLabel}} ends tomorrow',
    title: 'Your {{passLabel}} ends tomorrow',
    intro:
      'Your {{passLabel}} ends in about a day. Here is what happens to your account next, in two versions.',
    withoutPlanHeading: 'Without a plan',
    withoutPlan1: 'Tomorrow: the free limit is back. 100 cards a month.',
    withoutPlan2:
      'Next week: a lecture that comes out at 140 cards does not convert. It waits for next month, or for another pass.',
    withoutPlan3: 'Exam week: another pass, bought the night before.',
    withPlanHeading: 'With Pro',
    withPlan1: 'Tomorrow: same login, same decks, no gap. No card limit.',
    withPlan2: 'Next week: every conversion comes out whole.',
    withPlan3: 'Exam week: nothing to buy.',
    ctaIntro:
      'To get the second version, start Pro before your pass ends. Cancel any time.',
    cta: 'Start Pro',
    otherPasses:
      'Prefer another pass? The pricing page has Day and Week passes too. Pay once, nothing recurring.',
    replyLine:
      'A conversion not coming out right? Reply to this email. Alexander reads every one.',
    signoff: 'The 2anki Team',
  },
  semesterPassEnding: {
    subject: 'Renew your Semester Pass before it ends on {{endDate}}',
    title: 'Renew your Semester Pass before it ends on {{endDate}}',
    intro:
      'Your Semester Pass ends on {{endDate}}. Here is what happens to your account next, in two versions.',
    withoutPlanHeading: 'Without a renewal',
    withoutPlan1: 'After it ends: the free limit is back. 100 cards a month.',
    withoutPlan2:
      'Next week: a lecture that comes out at 140 cards does not convert. It waits for next month.',
    withoutPlan3: 'Exam week: a new pass, bought the night before.',
    withPlanHeading: 'With a renewal',
    withPlan1:
      'After it ends: the next 120 days start. Same login, same decks, no gap.',
    withPlan2: 'Next week: every conversion comes out whole.',
    withPlan3: 'Exam week: nothing to buy.',
    ctaIntro:
      'Renew before your pass ends. The button opens your account page, where you start the renewal. A renewal is a one-time payment. Nothing renews by itself.',
    cta: 'Renew Semester Pass',
    otherPasses:
      'Prefer a plan with no end date? Pro has no card limit, and you can cancel any time. Start it from the pricing page.',
    replyLine:
      'A conversion not coming out right? Reply to this email. Alexander reads every one.',
    signoff: 'The 2anki Team',
  },
  semesterRenewal: {
    subject: 'Your Semester Pass ends on {{endDate}}',
    title: 'Your Semester Pass ends on {{endDate}}',
    intro: 'Your Semester Pass ends on {{endDate}}.',
    renewBody:
      'Renew it now and the next 120 days start the moment this one ends. You lose no days, and your login and decks stay as they are.',
    oneTime: 'A renewal is a one-time payment. Nothing renews by itself.',
    cta: 'Renew Semester Pass',
    ctaNote:
      'The button opens your account page, where you can start the renewal.',
    replyLine: 'Questions about your pass? Reply to this email.',
    signoff: 'The 2anki Team',
  },
  subscriptionResumingSoon: {
    subject: 'Your 2anki subscription resumes on {{resumeDate}}',
    heading: 'Your subscription resumes on {{resumeDate}}',
    body: 'Your 2anki.net subscription pause ends on {{resumeDate}}. Billing resumes automatically at {{amount}} per month from that date.',
    bodyAtRegularPrice:
      'Your 2anki.net subscription pause ends on {{resumeDate}}. Billing resumes automatically at your regular price from that date.',
    nothingToDo:
      'Nothing to do if you want to keep going. Your decks and settings are exactly as you left them.',
    cancelPrefix: 'To cancel instead, go to your',
    cancelLink: 'account page',
    cancelSuffix:
      " before {{resumeDate}}. Cancelling during the pause ends your subscription right away, and you won't be charged again.",
    replyLine: 'Questions? Reply to this email.',
  },
  commercialShared: {
    unsubscribe: "Don't want emails like this? Unsubscribe",
  },
};

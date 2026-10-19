export interface ResetPasswordStrings {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  disclaimer: string;
  text: string;
}

export interface MagicLinkVariantStrings {
  subject: string;
  heading: string;
  description: string;
  cta: string;
  text: string;
}

export interface MagicLinkSharedStrings {
  expiry: string;
  disclaimer: string;
}

export interface DeckReadyStrings {
  subject: string;
  heading: string;
  bodyAttached: string;
  bodyTrouble: string;
  disclaimerPrefix: string;
  disclaimerSuffix: string;
  cardSingular: string;
  cardPlural: string;
  textReadyPrefix: string;
  textAttached: string;
}

export interface ReEngagementStrings {
  subject: string;
  title: string;
  heading: string;
  body: string;
  videoCaption: string;
  bodyPaste: string;
  bodyReply: string;
  cta: string;
  text: string;
}

export interface InactivityWarningStrings {
  subject: string;
  title: string;
  bodyWithConversion: string;
  bodyNoConversion: string;
  passLine: string;
  cta: string;
  housekeeping: string;
  signoff: string;
}

export interface AbandonedCheckoutStrings {
  subject: string;
  title: string;
  bodyStarted: string;
  bodySnag: string;
  cta: string;
  signoff: string;
}

export interface PassEndingStrings {
  subject: string;
  title: string;
  intro: string;
  withoutPlanHeading: string;
  withoutPlan1: string;
  withoutPlan2: string;
  withoutPlan3: string;
  withPlanHeading: string;
  withPlan1: string;
  withPlan2: string;
  withPlan3: string;
  ctaIntro: string;
  cta: string;
  otherPasses: string;
  replyLine: string;
  signoff: string;
}

export interface CommercialSharedStrings {
  unsubscribe: string;
}

export interface EmailStrings {
  resetPassword: ResetPasswordStrings;
  magicLinkLogin: MagicLinkVariantStrings;
  magicLinkReset: MagicLinkVariantStrings;
  magicLinkShared: MagicLinkSharedStrings;
  deckReady: DeckReadyStrings;
  reEngagement: ReEngagementStrings;
  inactivityWarning: InactivityWarningStrings;
  abandonedCheckout: AbandonedCheckoutStrings;
  passEnding: PassEndingStrings;
  commercialShared: CommercialSharedStrings;
}

export type SupportedEmailLanguage = 'en' | 'de';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? T[K] : DeepPartial<T[K]>;
};

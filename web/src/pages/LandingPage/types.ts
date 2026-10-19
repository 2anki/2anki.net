export interface LandingFaq {
  q: string;
  a: string;
}

export interface WhatComesAcrossItem {
  title: string;
  body: string;
}

export interface RelatedLink {
  label: string;
  href: string;
}

export interface LandingStep {
  title: string;
  body: string;
}

export interface LandingAlternate {
  hreflang: string;
  href: string;
}

export interface LandingCopy {
  pathname: string;
  canonicalPathname?: string;
  title: string;
  description: string;
  h1: string;
  subhead: string;
  faqs: LandingFaq[];
  ctaLabel?: string;
  ctaHref?: string;
  whatComesAcross?: WhatComesAcrossItem[];
  relatedLinks?: ReadonlyArray<RelatedLink>;
  galleryBadge?: boolean;
  // The front page's hero: centred, with the mascot, a sample deck for a
  // visitor without a file, and the trust note. Trialled on the AI page first.
  homeHero?: boolean;
  // The default steps and format list describe building a deck from a document.
  // A page that runs the other direction — a deck in, something else out — has
  // to say so, or it tells the visitor to open an .apkg that it never produces.
  steps?: ReadonlyArray<LandingStep>;
  formats?: ReadonlyArray<string>;
  htmlLang?: string;
  alternates?: ReadonlyArray<LandingAlternate>;
}

import type { TripwireMetricKey } from '../../../data_layer/MetricTripwireRepository';

export interface TripwireMetric {
  key: TripwireMetricKey;
  label: string;
  source: string;
  minRelativeDrop: number;
}

// Each minRelativeDrop sits above the largest day-on-day dip the metric
// showed over a normal month, so ordinary variation does not page.
export const TRIPWIRE_METRICS: readonly TripwireMetric[] = [
  {
    key: 'conversion_success',
    label: 'Conversions that succeeded',
    source:
      'events: conversion_succeeded / (conversion_succeeded + conversion_failed). One row is one conversion that reached an outcome, any source.',
    minRelativeDrop: 0.15,
  },
  {
    key: 'deck_has_cards',
    label: 'Successful decks with 3 or more cards',
    source:
      "events: conversion_succeeded rows whose card_count_bucket is not '<3' / conversion_succeeded rows with a bucket. One row is one successful conversion.",
    minRelativeDrop: 0.15,
  },
  {
    key: 'download_after_success',
    label: 'People who downloaded a deck the day they converted',
    source:
      'events: person-days with conversion_succeeded that also have deck_downloaded on the same UTC day. One unit is one person (user id, else anonymous id) on one day.',
    minRelativeDrop: 0.2,
  },
  {
    key: 'upload_after_page_view',
    label: 'Upload page visitors who started an upload',
    source:
      'events: person-days with upload_page_viewed that also have upload_started on the same UTC day. One unit is one person on one day.',
    minRelativeDrop: 0.25,
  },
  {
    key: 'partial_notice_signed_in',
    label: 'Signed-in over-limit uploads that showed a held-back offer or gate',
    source:
      'events: signed-in person-days with an upload conversion_succeeded carrying card_limit_partial that also have monthly_partial_offer_shown or anonymous_partial_gate_shown on the same UTC day. One unit is one person on one day.',
    minRelativeDrop: 0.4,
  },
  {
    key: 'partial_notice_anonymous',
    label: 'Anonymous over-limit uploads that showed a held-back gate or offer',
    source:
      'events: anonymous person-days with an upload conversion_succeeded carrying card_limit_partial that also have anonymous_partial_gate_shown or monthly_partial_offer_shown on the same UTC day. One unit is one anonymous id on one day.',
    minRelativeDrop: 0.4,
  },
];

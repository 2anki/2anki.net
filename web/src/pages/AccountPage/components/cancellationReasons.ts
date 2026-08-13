export const CANCELLATION_REASONS = [
  'I finished what I needed',
  "I don't use it enough",
  'Too expensive',
  'I found an alternative',
  'Technical issues',
  'Other',
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const REASON_KEYS: Record<CancellationReason, string> = {
  'I finished what I needed': 'reasons.finished',
  "I don't use it enough": 'reasons.notEnough',
  'Too expensive': 'reasons.tooExpensive',
  'I found an alternative': 'reasons.foundAlternative',
  'Technical issues': 'reasons.technicalIssues',
  Other: 'reasons.other',
};

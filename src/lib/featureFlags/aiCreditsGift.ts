// Master switch for the time-limited free AI credits gift. Off (the seeded
// default) hides the present, refuses every claim and leaves claimed gift
// credits unspendable; the date window in lib/claude/aiCredits/gift applies on
// top of it.
export const AI_CREDITS_GIFT_FLAG = 'ai_credits_gift';

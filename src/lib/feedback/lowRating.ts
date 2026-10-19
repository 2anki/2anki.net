export const LOW_RATING_MAX = 2;

export const isLowRating = (rating: number): boolean =>
  Number.isInteger(rating) && rating <= LOW_RATING_MAX;

const REPLY_TO_MAX_LENGTH = 254;
const SINGLE_ADDRESS = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const isSafeReplyTo = (email: string): boolean =>
  email.length <= REPLY_TO_MAX_LENGTH &&
  !/[\r\n]/.test(email) &&
  SINGLE_ADDRESS.test(email);

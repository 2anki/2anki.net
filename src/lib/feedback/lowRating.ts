export const LOW_RATING_MAX = 2;

export const isLowRating = (rating: number): boolean =>
  Number.isInteger(rating) && rating <= LOW_RATING_MAX;

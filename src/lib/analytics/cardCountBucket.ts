export type CardCountBucket = '<3' | '3-49' | '50-499' | '500+';

export function toCardCountBucket(count: number): CardCountBucket {
  if (count < 3) return '<3';
  if (count < 50) return '3-49';
  if (count < 500) return '50-499';
  return '500+';
}

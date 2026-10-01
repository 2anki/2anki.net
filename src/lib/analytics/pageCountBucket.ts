export type PageCountBucket = '1-5' | '6-20' | '21-50' | '51-100' | '100+';

export function toPageCountBucket(pageCount: number): PageCountBucket {
  if (pageCount <= 5) return '1-5';
  if (pageCount <= 20) return '6-20';
  if (pageCount <= 50) return '21-50';
  if (pageCount <= 100) return '51-100';
  return '100+';
}

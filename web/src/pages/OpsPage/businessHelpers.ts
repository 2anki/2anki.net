const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const parseUtcDate = (iso: string): Date | null => {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export const formatDailyLabel = (iso: string): string => {
  const date = parseUtcDate(iso);
  if (date == null) return iso;
  return `${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
};

export const formatWeekLabel = (iso: string): string => {
  const date = parseUtcDate(iso);
  if (date == null) return iso;
  return `Week of ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
};

export const formatUsd = (amount: number): string => {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const rounded = Math.round(abs);
  return `${sign}$${rounded.toLocaleString('en-US')}`;
};

export const formatInteger = (value: number): string =>
  Math.round(value).toLocaleString('en-US');

export const formatPercentOneDecimal = (value: number): string =>
  `${value.toFixed(1)}%`;

const padTwo = (n: number): string => n.toString().padStart(2, '0');

export const formatClockShort = (date: Date): string =>
  `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;

export const formatCacheAge = (cacheAgeSeconds: number): string => {
  if (cacheAgeSeconds < 60) return `${cacheAgeSeconds}s old`;
  const minutes = Math.floor(cacheAgeSeconds / 60);
  return `${minutes}m old`;
};

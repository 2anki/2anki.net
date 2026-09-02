import type { PassKind } from '../../data_layer/UserPassRepository';

export function passKindLabel(kind: PassKind): string {
  if (kind === '7d') return 'Week Pass';
  if (kind === '24h') return 'Day Pass';
  if (kind === '120d') return 'Semester Pass';
  return 'Pass';
}

const EMAIL_MAX_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function isValidEmailShape(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length <= EMAIL_MAX_LENGTH && EMAIL_SHAPE.test(normalized);
}

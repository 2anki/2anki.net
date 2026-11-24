const EMAIL_MAX_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const NON_PRINTING = /[\p{Cc}\p{Cf}]/u;

export function isValidEmailShape(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length <= EMAIL_MAX_LENGTH &&
    !NON_PRINTING.test(normalized) &&
    EMAIL_SHAPE.test(normalized)
  );
}

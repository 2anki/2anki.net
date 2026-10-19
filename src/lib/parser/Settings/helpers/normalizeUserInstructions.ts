import { getDefaultUserInstructions } from '../../../../infrastracture/adapters/fileConversion/convertPDFToHTML';

const WHITESPACE = /\s/;

function stripLegacyDefaultPrefix(value: string): string | null {
  const legacyDefault = getDefaultUserInstructions().trim();
  let valueIndex = 0;
  let defaultIndex = 0;
  while (defaultIndex < legacyDefault.length) {
    if (WHITESPACE.test(legacyDefault[defaultIndex])) {
      if (valueIndex >= value.length || !WHITESPACE.test(value[valueIndex])) {
        return null;
      }
      while (
        defaultIndex < legacyDefault.length &&
        WHITESPACE.test(legacyDefault[defaultIndex])
      ) {
        defaultIndex += 1;
      }
      while (valueIndex < value.length && WHITESPACE.test(value[valueIndex])) {
        valueIndex += 1;
      }
      continue;
    }
    if (value[valueIndex] !== legacyDefault[defaultIndex]) {
      return null;
    }
    valueIndex += 1;
    defaultIndex += 1;
  }
  return value.slice(valueIndex);
}

export function normalizeUserInstructions(
  raw: string | undefined
): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const remainder = stripLegacyDefaultPrefix(trimmed);
  if (remainder == null) return trimmed;
  const rest = remainder.trim();
  return rest.length === 0 ? undefined : rest;
}

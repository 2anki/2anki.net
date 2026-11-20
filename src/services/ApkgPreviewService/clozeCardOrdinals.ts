const CLOZE_TOKEN = /\{\{c(\d+)::|\}\}/g;
const MAX_OPEN_CLOZES = 10;
const MAX_CLOZE_NUMBER = 65_535;

function addOrdinalsOfField(field: string, ordinals: Set<number>): void {
  const open: number[] = [];
  for (const [, digits] of field.matchAll(CLOZE_TOKEN)) {
    if (digits == null) {
      const closed = open.pop();
      if (closed != null && closed > 0) ordinals.add(closed - 1);
    } else {
      const clozeNumber = Number(digits);
      if (clozeNumber <= MAX_CLOZE_NUMBER && open.length < MAX_OPEN_CLOZES) {
        open.push(clozeNumber);
      }
    }
  }
}

export function clozeCardOrdinals(fields: string[]): Set<number> {
  const ordinals = new Set<number>();
  for (const field of fields) addOrdinalsOfField(field, ordinals);
  return ordinals;
}

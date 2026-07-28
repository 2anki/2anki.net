import { InducedRescue, mergeInducedRescue } from './candidateRules';

const shipped: InducedRescue = { rule: 'heading', outcome: 'rescue_shipped' };
const rejected: InducedRescue = { rule: 'bullets', outcome: 'rescue_rejected' };

describe('mergeInducedRescue', () => {
  it('keeps a shipped rescue when a later sub-deck rejects one', () => {
    expect(mergeInducedRescue(shipped, rejected)).toBe(shipped);
  });

  it('upgrades a rejected rescue when a later sub-deck ships one', () => {
    expect(mergeInducedRescue(rejected, shipped)).toBe(shipped);
  });

  it('takes the first outcome when there is nothing to keep', () => {
    expect(mergeInducedRescue(undefined, rejected)).toBe(rejected);
    expect(mergeInducedRescue(undefined, shipped)).toBe(shipped);
  });

  it('keeps recording the latest shipped rescue', () => {
    const later: InducedRescue = { rule: 'quote', outcome: 'rescue_shipped' };
    expect(mergeInducedRescue(shipped, later)).toBe(later);
  });
});

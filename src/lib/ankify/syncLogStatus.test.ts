import { syncLogStatus } from './syncLogStatus';

describe('syncLogStatus', () => {
  it('reports success when no card errored', () => {
    expect(syncLogStatus({ created: 10, updated: 2, errors: [] })).toBe(
      'success'
    );
    expect(syncLogStatus({ created: 0, updated: 0, errors: [] })).toBe(
      'success'
    );
  });

  it('reports partial when cards landed despite per-card errors', () => {
    expect(
      syncLogStatus({ created: 390, updated: 0, errors: ['bad image'] })
    ).toBe('partial');
    expect(
      syncLogStatus({ created: 0, updated: 4, errors: ['bad image'] })
    ).toBe('partial');
  });

  it('reports error when nothing landed', () => {
    expect(
      syncLogStatus({ created: 0, updated: 0, errors: ['Notion fetch failed'] })
    ).toBe('error');
  });
});

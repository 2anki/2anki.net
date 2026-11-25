import knex from 'knex';
import { vi } from 'vitest';

import { createAiGiftReaders } from './createAiGiftReaders';

describe('createAiGiftReaders', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the wall clock, the same time the gift conversion marker used before', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-02T08:30:00.000Z'));

    const readers = createAiGiftReaders(knex({ client: 'pg' }));

    expect(readers.now().getTime()).toBe(Date.now());
    expect(readers.now().toISOString()).toBe('2026-12-02T08:30:00.000Z');
  });
});

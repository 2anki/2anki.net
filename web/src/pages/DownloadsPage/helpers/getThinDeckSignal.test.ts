import { describe, expect, it } from 'vitest';

import { getThinDeckSignal } from './getThinDeckSignal';
import JobResponse from '../../../schemas/public/JobResponse';
import { JobsId } from '../../../schemas/public/Jobs';

const doneNotionJob = (
  overrides: Partial<JobResponse>,
  payload?: unknown
): JobResponse =>
  ({
    id: 1 as JobsId,
    owner: 'owner-1',
    object_id: 'page-1',
    status: 'done',
    created_at: new Date('2026-08-20T11:30:00Z'),
    last_edited_time: new Date('2026-08-20T11:30:00Z'),
    title: 'Notion deck',
    type: 'page',
    job_reason_failure: payload == null ? null : JSON.stringify(payload),
    card_count: 12,
    restartable: true,
    download_key: 'deck.apkg',
    upload_id: null,
    empty_back_count: 0,
    ...overrides,
  }) as JobResponse;

describe('getThinDeckSignal', () => {
  it('counts empty toggles from empty_back_count', () => {
    const signal = getThinDeckSignal(doneNotionJob({ empty_back_count: 14 }));
    expect(signal.candidateSkips).toBe(14);
    expect(signal.reason).toBe('emptyToggles');
  });

  it('counts forbidden blocks as not-connected parts', () => {
    const signal = getThinDeckSignal(
      doneNotionJob(
        {},
        { code: 'notion_blocks_forbidden', forbidden_blocks: 3 }
      )
    );
    expect(signal.candidateSkips).toBe(3);
    expect(signal.reason).toBe('notConnected');
  });

  it('sums unsupported block types into the generic family', () => {
    const signal = getThinDeckSignal(
      doneNotionJob({}, { unsupported_blocks: { pdf: 2, table: 3 } })
    );
    expect(signal.candidateSkips).toBe(5);
    expect(signal.reason).toBe('generic');
  });

  it('excludes dropped images from the candidate count', () => {
    const signal = getThinDeckSignal(
      doneNotionJob({ empty_back_count: 4 }, { dropped_assets: 9 })
    );
    expect(signal.candidateSkips).toBe(4);
    expect(signal.reason).toBe('emptyToggles');
  });

  it('adds empty toggles to forbidden parts when both payloads ride along', () => {
    const signal = getThinDeckSignal(
      doneNotionJob(
        { empty_back_count: 2 },
        { code: 'notion_blocks_forbidden', forbidden_blocks: 5 }
      )
    );
    expect(signal.candidateSkips).toBe(7);
    expect(signal.reason).toBe('notConnected');
  });

  it('falls back to generic when no family strictly dominates', () => {
    const signal = getThinDeckSignal(
      doneNotionJob(
        { empty_back_count: 3 },
        { code: 'notion_blocks_forbidden', forbidden_blocks: 3 }
      )
    );
    expect(signal.candidateSkips).toBe(6);
    expect(signal.reason).toBe('generic');
  });

  it('returns a zero, generic signal for a clean conversion', () => {
    const signal = getThinDeckSignal(doneNotionJob({ empty_back_count: 0 }));
    expect(signal.candidateSkips).toBe(0);
    expect(signal.reason).toBe('generic');
  });
});

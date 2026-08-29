import { describe, expect, it } from 'vitest';

import { getSignalSkippedCount } from './getSignalSkippedCount';
import JobResponse from '../../../schemas/public/JobResponse';
import { JobsId } from '../../../schemas/public/Jobs';

const doneNotionJob = (payload: unknown): JobResponse =>
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
  }) as JobResponse;

describe('getSignalSkippedCount', () => {
  it('counts dropped assets', () => {
    expect(getSignalSkippedCount(doneNotionJob({ dropped_assets: 4 }))).toBe(4);
  });

  it('counts forbidden blocks', () => {
    expect(
      getSignalSkippedCount(
        doneNotionJob({ code: 'notion_blocks_forbidden', forbidden_blocks: 3 })
      )
    ).toBe(3);
  });

  it('sums unsupported block types', () => {
    expect(
      getSignalSkippedCount(
        doneNotionJob({
          code: 'notion_unsupported_blocks',
          unsupported_blocks: { embed: 2, synced_block: 1 },
        })
      )
    ).toBe(3);
  });

  it('returns zero for a clean conversion', () => {
    expect(getSignalSkippedCount(doneNotionJob(null))).toBe(0);
  });

  it('returns zero for non-count signals like guessed columns', () => {
    expect(
      getSignalSkippedCount(
        doneNotionJob({
          code: 'notion_columns_guessed',
          front_field: 'Name',
          back_field: 'Notes',
        })
      )
    ).toBe(0);
  });
});

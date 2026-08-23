import { describe, expect, it } from 'vitest';
import { parseMonthlyLimitPartialPayload } from './parseMonthlyLimitPartialPayload';
import JobResponse from '../../../schemas/public/JobResponse';
import { JobsId } from '../../../schemas/public/Jobs';

function buildJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 1 as JobsId,
    owner: 'owner-1',
    object_id: 'page-id',
    status: 'done',
    created_at: new Date('2026-07-01T11:30:00Z'),
    last_edited_time: new Date('2026-07-01T11:30:00Z'),
    title: 'Long Notion Page',
    type: 'page',
    job_reason_failure: JSON.stringify({
      code: 'monthly_limit_partial',
      cards_delivered: 100,
      cards_held_back: 25,
      limit: 100,
      reset_on: '2026-08-01T00:00:00.000Z',
    }),
    card_count: null,
    restartable: false,
    download_key: 'deck.apkg',
    upload_id: null,
    ...overrides,
  };
}

describe('parseMonthlyLimitPartialPayload', () => {
  it('parses a partial-delivery done Notion page job', () => {
    expect(parseMonthlyLimitPartialPayload(buildJob())).toEqual({
      cardsDelivered: 100,
      cardsHeldBack: 25,
      limit: 100,
      resetOn: '2026-08-01T00:00:00.000Z',
    });
  });

  it('accepts database jobs', () => {
    expect(
      parseMonthlyLimitPartialPayload(buildJob({ type: 'database' }))
    ).not.toBeNull();
  });

  it('returns undefined resetOn when the payload omits it', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'monthly_limit_partial',
        cards_delivered: 100,
        cards_held_back: 25,
        limit: 100,
      }),
    });
    expect(parseMonthlyLimitPartialPayload(job)?.resetOn).toBeUndefined();
  });

  it.each([['apkg_import'], ['claude'], ['conversion'], [null]])(
    'ignores %s jobs',
    (type) => {
      expect(parseMonthlyLimitPartialPayload(buildJob({ type }))).toBeNull();
    }
  );

  it('ignores jobs that are not done', () => {
    expect(
      parseMonthlyLimitPartialPayload(buildJob({ status: 'failed' }))
    ).toBeNull();
  });

  it('ignores the truncation payload shape', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 100,
      }),
    });
    expect(parseMonthlyLimitPartialPayload(job)).toBeNull();
  });

  it('ignores a partial payload with nothing held back', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'monthly_limit_partial',
        cards_delivered: 100,
        cards_held_back: 0,
        limit: 100,
      }),
    });
    expect(parseMonthlyLimitPartialPayload(job)).toBeNull();
  });

  it.each([[null], [''], ['not json'], ['{}']])(
    'ignores reason %s',
    (reason) => {
      expect(
        parseMonthlyLimitPartialPayload(
          buildJob({ job_reason_failure: reason })
        )
      ).toBeNull();
    }
  );
});

import { describe, expect, it } from 'vitest';
import { rescueStatusFromResponse } from './rescueStatus';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('rescueStatusFromResponse', () => {
  it('says nothing once the re-run has started', async () => {
    expect(
      await rescueStatusFromResponse(json(202, { jobId: 1, restarted: true }))
    ).toBeNull();
  });

  it('reads a free user over the monthly limit as the limit line', async () => {
    expect(
      await rescueStatusFromResponse(
        json(402, { reason: 'monthly_limit', cards_used: 100, limit: 100 })
      )
    ).toEqual({ kind: 'limit', limit: 100 });
  });

  it('reads the free one-at-a-time limit as its own line', async () => {
    expect(
      await rescueStatusFromResponse(
        json(402, { reason: 'free_plan_one_at_a_time' })
      )
    ).toEqual({ kind: 'oneAtATime' });
  });

  it('reads a conversion already in flight as already running', async () => {
    expect(
      await rescueStatusFromResponse(
        json(409, { reason: 'already_in_progress' })
      )
    ).toEqual({ kind: 'alreadyRunning' });
  });

  it.each([500, 401, 400])(
    'reads any other status (%s) as a retry line',
    async (status) => {
      expect(
        await rescueStatusFromResponse(new Response('oops', { status }))
      ).toEqual({ kind: 'failed' });
    }
  );
});

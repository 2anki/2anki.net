// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelSubscription,
  cancelSubscriptionById,
  submitCancellationFeedback,
} from './cancelSubscription';
import * as api from './api';

vi.mock('./api', () => ({
  post: vi.fn(),
}));

const createMockResponse = (
  status: number,
  jsonData: unknown,
  statusText = ''
): Response =>
  ({
    status,
    statusText,
    json: vi.fn().mockResolvedValue(jsonData),
  }) as unknown as Response;

describe('cancelSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the success payload on 200', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(200, { message: 'scheduled' })
    );

    await expect(cancelSubscription()).resolves.toEqual({
      message: 'scheduled',
    });
  });

  it('defaults mode to period_end when called without args', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(200, { message: 'ok' })
    );

    await cancelSubscription();

    expect(api.post).toHaveBeenCalledWith('/api/users/cancel-subscription', {
      mode: 'period_end',
    });
  });

  it('sends the requested mode in the body', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(200, { message: 'ok' })
    );

    await cancelSubscription('immediate');

    expect(api.post).toHaveBeenCalledWith('/api/users/cancel-subscription', {
      mode: 'immediate',
    });
  });

  it('throws the server message from a JSON error body', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(
        404,
        { message: 'No active subscription found' },
        'Not Found'
      )
    );

    await expect(cancelSubscription()).rejects.toThrow(
      'No active subscription found'
    );
  });

  it('falls back to statusText when no JSON message is present', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(500, {}, 'Internal Server Error')
    );

    await expect(cancelSubscription()).rejects.toThrow('Internal Server Error');
  });

  it('does not send a reason when none is provided', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(200, { message: 'ok' })
    );

    await cancelSubscription('period_end');

    expect(api.post).toHaveBeenCalledWith('/api/users/cancel-subscription', {
      mode: 'period_end',
    });
  });

  it('sends the reason alongside the mode when provided', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(200, { message: 'ok' })
    );

    await cancelSubscription('period_end', "I don't use it enough");

    expect(api.post).toHaveBeenCalledWith('/api/users/cancel-subscription', {
      mode: 'period_end',
      reason: "I don't use it enough",
    });
  });
});

describe('cancelSubscriptionById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the mode to the per-subscription endpoint with the id in the path', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(200, { message: 'cancelled' })
    );

    await cancelSubscriptionById('sub_owned', 'immediate');

    expect(api.post).toHaveBeenCalledWith(
      '/api/users/subscriptions/sub_owned/cancel',
      { mode: 'immediate' }
    );
  });

  it('returns the success payload on 200', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(200, { message: 'cancelled' })
    );

    await expect(
      cancelSubscriptionById('sub_owned', 'immediate')
    ).resolves.toEqual({ message: 'cancelled' });
  });

  it('redirects to login on 401', async () => {
    const original = globalThis.location.href;
    vi.mocked(api.post).mockResolvedValue(createMockResponse(401, {}));

    await expect(
      cancelSubscriptionById('sub_owned', 'immediate')
    ).rejects.toThrow('Authentication required');

    globalThis.location.href = original;
  });

  it('throws the server message on a non-200 response', async () => {
    vi.mocked(api.post).mockResolvedValue(
      createMockResponse(
        403,
        { message: 'Subscription not found' },
        'Forbidden'
      )
    );

    await expect(
      cancelSubscriptionById('sub_other', 'immediate')
    ).rejects.toThrow('Subscription not found');
  });
});

describe('submitCancellationFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the reason and comment to the feedback endpoint', async () => {
    vi.mocked(api.post).mockResolvedValue(createMockResponse(200, {}));

    await submitCancellationFeedback('Too expensive', 'details');

    expect(api.post).toHaveBeenCalledWith('/api/users/cancellation-feedback', {
      reason: 'Too expensive',
      comment: 'details',
    });
  });
});

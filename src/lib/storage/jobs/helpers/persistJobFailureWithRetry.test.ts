import {
  isConnectionClassError,
  persistJobFailureWithRetry,
} from './persistJobFailureWithRetry';

function connectionError(code: string): Error {
  return Object.assign(new Error(`connect ${code} 127.0.0.1:5432`), { code });
}

describe('isConnectionClassError', () => {
  it('matches socket-level connection failures', () => {
    expect(isConnectionClassError(connectionError('ECONNREFUSED'))).toBe(true);
    expect(isConnectionClassError(connectionError('ECONNRESET'))).toBe(true);
    expect(isConnectionClassError(connectionError('ETIMEDOUT'))).toBe(true);
  });

  it('matches postgres shutdown/startup SQLSTATEs', () => {
    expect(isConnectionClassError(connectionError('57P01'))).toBe(true);
    expect(isConnectionClassError(connectionError('57P03'))).toBe(true);
  });

  it('does not match ordinary errors', () => {
    expect(isConnectionClassError(new Error('boom'))).toBe(false);
    expect(
      isConnectionClassError(
        Object.assign(new Error('bad sql'), { code: '42601' })
      )
    ).toBe(false);
    expect(isConnectionClassError(undefined)).toBe(false);
  });
});

describe('persistJobFailureWithRetry', () => {
  it('returns after the first attempt when the write succeeds', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await persistJobFailureWithRetry(write, { sleepFn });

    expect(write).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('retries a connection-class failure until the database is back', async () => {
    const write = jest
      .fn()
      .mockRejectedValueOnce(connectionError('ECONNREFUSED'))
      .mockRejectedValueOnce(connectionError('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await persistJobFailureWithRetry(write, { sleepFn });

    expect(write).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-connection failure', async () => {
    const err = new Error('constraint violation');
    const write = jest.fn().mockRejectedValue(err);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(persistJobFailureWithRetry(write, { sleepFn })).rejects.toBe(
      err
    );
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last error when attempts are exhausted', async () => {
    const err = connectionError('ECONNREFUSED');
    const write = jest.fn().mockRejectedValue(err);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(persistJobFailureWithRetry(write, { sleepFn })).rejects.toBe(
      err
    );
    expect(write).toHaveBeenCalledTimes(4);
    expect(sleepFn).toHaveBeenCalledTimes(3);
  });
});

import { retryWithBackoff } from '../../src/core/services/retry-with-backoff';

function fakeDelay(recorded: number[]) {
  return async (ms: number): Promise<void> => {
    recorded.push(ms);
  };
}

describe('retryWithBackoff', () => {
  it('returns the result on the first attempt if fn does not fail', async () => {
    const delays: number[] = [];
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { delayFn: fakeDelay(delays) });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('retries with 1s/2s/4s backoff until maxRetries=3 is exhausted (4 total calls) and rethrows the last error', async () => {
    const delays: number[] = [];
    const error = new Error('simulated failure');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1000, delayFn: fakeDelay(delays) }),
    ).rejects.toBe(error);

    expect(fn).toHaveBeenCalledTimes(4); // 1 intento inicial + 3 reintentos
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('recovers if fn succeeds on an intermediate retry, without exhausting all retries', async () => {
    const delays: number[] = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce('recovered');

    const result = await retryWithBackoff(fn, { delayFn: fakeDelay(delays) });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([1000]);
  });

  it('invokes onRetry with the retry number before each wait', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, delayFn: fakeDelay([]), onRetry }),
    ).rejects.toThrow('always fails');

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
  });

  it('honors maxRetries=0: a single call, with no retries or delays', async () => {
    const delays: number[] = [];
    const error = new Error('no retries');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(retryWithBackoff(fn, { maxRetries: 0, delayFn: fakeDelay(delays) })).rejects.toBe(
      error,
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('with Jest fake timers, the default real delay (setTimeout) also honors the expected values', async () => {
    jest.useFakeTimers();
    try {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fails once'))
        .mockResolvedValueOnce('ok');

      const promise = retryWithBackoff(fn, { maxRetries: 1 });
      await jest.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

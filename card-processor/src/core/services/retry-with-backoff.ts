export interface RetryWithBackoffOptions {
  /** Reintentos máximos tras el intento inicial (default 3). */
  maxRetries?: number;
  /** Base del backoff exponencial en ms (default 1000). */
  baseDelayMs?: number;
  delayFn?: (ms: number) => Promise<void>;
  /** Callback informativo, invocado antes de cada espera de reintento. */
  onRetry?: (retryNumber: number, error: unknown) => void;
}

const defaultDelayFn = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryWithBackoffOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const delay = options.delayFn ?? defaultDelayFn;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      const retryNumber = attempt + 1;
      options.onRetry?.(retryNumber, error);
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
}

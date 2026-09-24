/**
 * Serialises GATT operations and computes reconnect backoff. No dependencies.
 *
 * Android's BLE stack runs one GATT operation at a time; issuing reads/writes in parallel
 * fails randomly (GATT_BUSY, "operation was cancelled"). Route every read, write,
 * descriptor write and MTU request for a device through one queue.
 */

export class GattTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'GattTimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'GATT operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GattTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class GattQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private cleared = 0;

  /** Number of operations waiting or running. */
  get size(): number {
    return this.pending;
  }

  /**
   * Runs `op` after every previously enqueued op has settled. A failing or timed-out op
   * does not block the queue.
   */
  run<T>(op: () => Promise<T>, { timeoutMs = 10_000, label = 'GATT operation' } = {}): Promise<T> {
    const generation = this.cleared;
    this.pending++;
    const result = this.tail.then(() => {
      if (generation !== this.cleared) throw new Error(`${label} dropped: queue cleared (device disconnected)`);
      return withTimeout(op(), timeoutMs, label);
    });
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.tail = settled.then(() => {
      this.pending--;
    });
    return result;
  }

  /** Call on disconnect: ops still waiting are rejected instead of hitting a dead connection. */
  clear(): void {
    this.cleared++;
  }
}

/**
 * Exponential backoff with full jitter: attempt 0 → [0, 1 s], 1 → [0, 2 s] … capped at `maxMs`.
 * Returns undefined once `maxAttempts` is reached, meaning give up and tell the user.
 */
export function reconnectDelayMs(
  attempt: number,
  { baseMs = 1000, maxMs = 30_000, maxAttempts = 8, random = Math.random } = {},
): number | undefined {
  if (attempt >= maxAttempts) return undefined;
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

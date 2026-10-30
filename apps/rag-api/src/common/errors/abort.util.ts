/** Fallbacks must not turn a caller cancellation into another model request. */
export function rethrowIfAborted(error: unknown, signal?: AbortSignal): void {
  const errorLike = error as { name?: string; code?: string } | null;
  if (
    signal?.aborted ||
    errorLike?.name === 'AbortError' ||
    errorLike?.name === 'TimeoutError' ||
    errorLike?.code === 'ABORT_ERR' ||
    errorLike?.code === 'ERR_CANCELED'
  ) {
    throw error;
  }
}

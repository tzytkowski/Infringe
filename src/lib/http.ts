/** Bound each request so an unavailable feed cannot leave the dashboard loading forever. */
export async function fetchJSONResponse(url: string, options: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 20_000, signal, ...init } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (cause) {
    if (timeout.aborted && !signal?.aborted) throw new Error('The data source took too long to respond. Refresh to retry.');
    throw cause;
  }
}

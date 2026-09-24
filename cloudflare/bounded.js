// Bound waiting even if an RPC or a response body ignores cancellation.
export function withSignal(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([operation, cancelled]).finally(() => signal.removeEventListener('abort', abort));
}

export function boundedRpc(operation, signal, timeoutMs = 5000) {
  return withDeadline(timed => withSignal(operation, timed), signal, timeoutMs);
}

/** @template T
 * @param {(signal: AbortSignal) => Promise<T> | T} callback
 * @param {AbortSignal | undefined} signal
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
export async function withDeadline(callback, signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded', 'TimeoutError')), timeoutMs);
  try { return await callback(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal); }
  finally { clearTimeout(timer); }
}

export function cancelBody(body) {
  try { void body?.cancel().catch(() => {}); } catch { /* Best effort only. */ }
}

export async function boundedText(response, signal, maximumBytes = 262144) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await withSignal(reader.read(), signal);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) throw new Error('response_size');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    try { void reader.cancel().catch(() => {}); } catch { /* Best effort only. */ }
    reader.releaseLock();
  }
}

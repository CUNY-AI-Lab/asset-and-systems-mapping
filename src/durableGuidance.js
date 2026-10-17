const marker = projectId => `systems-mapping.pending-guidance.${projectId}`;

export function hasPendingGuidance(storage, projectId, requestKey) {
  try { return JSON.parse(storage.getItem(marker(projectId)) || 'null')?.requestKey === requestKey; }
  catch { return false; }
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function durableGuidance(request, makeError, kind, input, { signal, storage, projectId, requestKey, resume = false, retryFailed = false, onProgress = () => {} }) {
  const key = marker(projectId);
  let record;
  try { record = JSON.parse(storage.getItem(key) || 'null'); } catch { /* Start a new explicit request below. */ }
  if (record?.requestKey !== requestKey || retryFailed) record = null;
  if (resume && !record) throw makeError('The saved request belongs to earlier inputs. Choose Generate to use the current memo.', 409);
  if (record && (!record.createdAt || record.createdAt + 86400000 <= Date.now())) {
    try { storage.removeItem(key); } catch {}
    throw makeError('The saved request expired. Choose Generate again to start a new request.', 410);
  }
  record ||= { requestKey, requestToken: crypto.randomUUID(), createdAt: Date.now(), ...(retryFailed ? { retryToken: crypto.randomUUID() } : {}) };
  const remember = () => { try { storage.setItem(key, JSON.stringify(record)); } catch { /* Server still retains the request. */ } };
  const clear = () => { try { if (hasPendingGuidance(storage, projectId, requestKey)) storage.removeItem(key); } catch { /* Saved server outcome remains authoritative. */ } };
  const call = async (path, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Connection timed out', 'TimeoutError')), options.wait ? 30000 : 12000);
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const { wait: _wait, ...requestOptions } = options;
      return await Promise.race([
        request(path, { ...requestOptions, workspace: storage, signal: controller.signal }),
        new Promise((_, reject) => { if (controller.signal.aborted) reject(controller.signal.reason); else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }); }),
      ]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
  remember();
  let page = record.jobId ? { job: { id: record.jobId, state: 'running' } } : null, networkFailures = 0;
  const started = Date.now();
  while (Date.now() - started < 180000) {
    signal?.throwIfAborted();
    try {
      if (!page) page = await call('/api/cloud/guidance-jobs', { method: 'POST', body: { kind, input, requestToken: record.requestToken, ...(record.retryToken ? { retryToken: record.retryToken } : {}) } });
      else if (page.job.state === 'retry_wait' && page.job.retryAt <= Date.now()) page = await call(`/api/cloud/guidance-jobs/${page.job.id}/resume`, { method: 'POST' });
      // A long-poll read holds server-side until the attempt settles, so the
      // loop issues far fewer authenticated requests per action.
      else page = await call(`/api/cloud/guidance-jobs/${page.job.id}?wait=1`, { method: 'GET', wait: true });
      networkFailures = 0;
      record.jobId = page.job.id; remember();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error.status && ![503,504].includes(error.status)) { if (!page || ![401,403].includes(error.status)) clear(); throw error; }
      if (++networkFailures > 3) throw makeError('Connection interrupted. Your generation request is saved. Reopen this map to recover its status.', 503, { details: { code: 'guidance_pending' } });
      onProgress('Reconnecting to your saved request…');
      await pause(1000 * 2 ** (networkFailures - 1), signal);
      continue;
    }
    if (page.job.state === 'succeeded') { clear(); return page.result; }
    if (page.job.state === 'failed') { clear(); throw makeError(page.result?.error || 'Generation needs another attempt. Your work is saved.', page.resultStatus || 503, page.result); }
    onProgress(page.job.state === 'retry_wait' ? `Temporary model interruption. Retrying after the requested delay (attempt ${page.job.attempts + 1} of 3)…` : `${kind === 'map-check' ? 'Checking your map' : 'Reading memo'} (attempt ${page.job.attempts} of 3)…`);
    await pause(page.job.state === 'retry_wait' ? 2000 : 250, signal);
  }
  throw makeError('Your request is saved. Reopen this map to check its progress.', 503, { details: { code: 'guidance_pending' } });
}

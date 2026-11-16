import React, { useEffect, useRef, useState } from 'react';
import { appPath } from './appPath.js';
import { courseRequestHeaders, parseCourseSelection, courseWorkspacePath } from './courseContext.js';
import { institutionalLoginUrl } from './accountStorage.js';
import { parseProject, serializeProject } from './domain.js';
import { reconcileCloudProject, projectDigest, serializeCloudProject } from './cloudSync.js';
import { downloadBlob } from './mapExport.js';
import { captureBrowserSnapshot, recoveryStorage, recoveryNonce, recoveryFingerprint, parseBrowserSnapshot, reviewBrowserSnapshot, stageBrowserSnapshot, stagedBrowserSnapshots, applyRecoveryPreference, recoverableRelationshipDrafts, restoreRecoveryRelationships } from './browserRecovery.js';
import { offerRecovery, receiveRecovery } from './browserRecoveryChannel.js';

export const recoveryView = (search = window.location.search) => {
  const values = new URLSearchParams(search).getAll('browserRecovery');
  return values.length === 1 && ['source', 'destination'].includes(values[0]) ? values[0] : null;
};
export function recoveryPagePath(selection) {
  const url = new URL(courseWorkspacePath('/', selection), window.location.origin);
  url.searchParams.set('browserRecovery', 'destination');
  return url.pathname + url.search;
}
const download = (name, value) => downloadBlob(new Blob([value], { type: 'application/json' }), name);
const safeError = 'Recovery could not continue. Check that both addresses use the same CUNY account and course, then try again. The original copies are unchanged.';
const reviewBackup = (raw, review, persisted) => ({ raw, review, persisted,
  conflicts: review.comparisons.filter(entry => entry.status === 'conflict').map(({ key, scope, current }) => ({ key, scope, value: current })) });

export default function BrowserRecovery({ mode = recoveryView() }) {
  const [selection] = useState(() => parseCourseSelection(window.location.search));
  const [context, setContext] = useState(null), [authorization, setAuthorization] = useState(null);
  const [status, setStatus] = useState('Checking this account and course…'), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [backup, setBackup] = useState(null), [archives, setArchives] = useState([]);
  const [unsupported, setUnsupported] = useState(false);
  const [comparisons, setComparisons] = useState({}), [saved, setSaved] = useState({});
  const cleanup = useRef(null), mounted = useRef(true);
  const activeScope = useRef(null);
  const invalidate = () => {
    activeScope.current = null; cleanup.current?.();
    setContext(null); setAuthorization(null); setBackup(null); setArchives([]); setComparisons({}); setSaved({});
    setBusy(false); setError(safeError); setStatus('Account access changed. Reopen recovery after signing in.');
  };
  const assertCurrent = cacheKey => { if (!mounted.current || activeScope.current !== cacheKey) throw new Error(safeError); };
  const request = async (path, body, cacheKey, signal) => {
    const response = await fetch(appPath(path), { method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error',
      headers: { ...courseRequestHeaders(selection), ...(cacheKey ? { 'x-systems-account-cache': cacheKey } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error(safeError), { status: response.status });
    return response.json();
  };
  const currentAccount = async (expected, signal) => {
    try {
      const { account } = await request('/api/cloud/account', null, null, signal);
      if (account?.browserRecovery === null) throw Object.assign(new Error('Recovery is unavailable here.'), { unsupported: true });
      if (!account || (expected && account.cacheKey !== expected) || (account.course?.id ?? null) !== selection.id
        || !account.browserRecovery || !['https://tools.ailab.gc.cuny.edu', 'https://systems-mapping.ailab-452.workers.dev'].includes(account.browserRecovery.peerOrigin)
        || !['/', '/systems-mapping/'].includes(account.browserRecovery.peerPath)) throw new Error(safeError);
      if (expected) assertCurrent(expected);
      return account;
    } catch (failure) { if (expected && mounted.current) invalidate(); throw failure; }
  };
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const account = await currentAccount(null, controller.signal);
        if (controller.signal.aborted) return;
        const storage = recoveryStorage(window.localStorage, account.cacheKey);
        activeScope.current = account.cacheKey;
        setContext({ account, storage });
        setStatus(mode === 'source' ? 'Waiting for the recovery page…' : 'Ready to recover browser copies from the other address.');
        if (mode !== 'source') setArchives(stagedBrowserSnapshots(storage));
      } catch (failure) {
        if (!controller.signal.aborted) {
          if (failure.unsupported) { setUnsupported(true); setStatus('Browser recovery is available between the original production address and CUNY Tools. This separate workspace has no recovery connection.'); }
          else { setError(safeError); setStatus('Sign in to this address first, then reopen recovery.'); }
        }
      }
    })();
    return () => { mounted.current = false; activeScope.current = null; controller.abort(); cleanup.current?.(); };
  }, []);
  useEffect(() => {
    if (!context) return;
    const recheck = () => { if (document.visibilityState !== 'hidden') void currentAccount(context.account.cacheKey).catch(() => {}); };
    window.addEventListener('focus', recheck); window.addEventListener('pageshow', recheck); document.addEventListener('visibilitychange', recheck);
    return () => { window.removeEventListener('focus', recheck); window.removeEventListener('pageshow', recheck); document.removeEventListener('visibilitychange', recheck); };
  }, [context]);
  useEffect(() => {
    if (!context || mode !== 'source') return;
    return offerRecovery({ peerOrigin: context.account.browserRecovery.peerOrigin, onAuthorization: value => {
      setAuthorization(value); setStatus('Ready to read this account’s browser copies.');
    } });
  }, [context, mode]);

  const readSource = async () => {
    setBusy(true); setError('');
    try {
      await currentAccount(context.account.cacheKey);
      const raw = captureBrowserSnapshot(context.storage, window.localStorage);
      const fingerprint = await recoveryFingerprint(raw);
      const receipt = await request('/api/cloud/browser-recovery/verify', { nonce: authorization.nonce, token: authorization.token, fingerprint }, context.account.cacheKey);
      assertCurrent(context.account.cacheKey);
      authorization.send({ type: 'snapshot', raw, fingerprint, receipt: receipt.token });
      setAuthorization(null); setStatus('Browser copies sent for review. This address and its open tabs were not changed.');
    } catch { authorization?.send({ type: 'error' }); setError(safeError); }
    finally { if (mounted.current) setBusy(false); }
  };
  const start = async () => {
    // Open synchronously with the click, then navigate only to the fixed peer.
    const popup = window.open('about:blank', '_blank', 'popup,width=640,height=720');
    if (!popup) { setError('Allow this recovery popup, then try again.'); return; }
    setBusy(true); setError(''); cleanup.current?.();
    try {
      await currentAccount(context.account.cacheKey);
      const nonce = recoveryNonce();
      const proof = await request('/api/cloud/browser-recovery/issue', { nonce }, context.account.cacheKey);
      assertCurrent(context.account.cacheKey);
      cleanup.current = receiveRecovery({ popup, peerOrigin: context.account.browserRecovery.peerOrigin, nonce, proof,
        onError: () => { if (mounted.current) { setError(safeError); setBusy(false); } },
        onSnapshot: async data => {
          parseBrowserSnapshot(data.raw);
          if (await recoveryFingerprint(data.raw) !== data.fingerprint) throw new Error(safeError);
          await request('/api/cloud/browser-recovery/consume', { nonce, token: data.receipt, fingerprint: data.fingerprint }, context.account.cacheKey);
          await currentAccount(context.account.cacheKey);
          assertCurrent(context.account.cacheKey);
          const review = await reviewBrowserSnapshot(data.raw, context.storage, window.localStorage);
          assertCurrent(context.account.cacheKey);
          const incoming = reviewBackup(data.raw, review, false);
          setBackup(incoming); setComparisons({}); setSaved({});
          try {
            const staged = await stageBrowserSnapshot(data.raw, context.storage, window.localStorage, { assertCurrent: () => assertCurrent(context.account.cacheKey) });
            assertCurrent(context.account.cacheKey);
            setBackup(reviewBackup(data.raw, staged.review, true)); setArchives(stagedBrowserSnapshots(context.storage));
            setStatus('Backup saved separately on this device. Review before restoring.');
          } catch { setError('The backup could not be saved safely on this device. Download the private backup before closing this page. Active work is unchanged.'); }
          setBusy(false);
        } });
      const url = new URL(context.account.browserRecovery.peerPath, context.account.browserRecovery.peerOrigin);
      url.searchParams.set('browserRecovery', 'source');
      if (selection.kind === 'course') url.searchParams.set('course', selection.id);
      popup.location.href = url.href;
      setStatus('In the new window, choose Read browser copies. Keep this page open.');
    } catch { popup.close(); setError(safeError); setBusy(false); }
  };
  const reopen = async entry => {
    setBusy(true); setError('');
    try {
      await currentAccount(context.account.cacheKey);
      const review = await reviewBrowserSnapshot(entry.raw, context.storage, window.localStorage);
      assertCurrent(context.account.cacheKey);
      setBackup(reviewBackup(entry.raw, review, false)); setComparisons({}); setSaved({});
      // A preference may have changed since the archive was first received.
      // Preserve that current value before enabling an explicit replacement.
      const staged = await stageBrowserSnapshot(entry.raw, context.storage, window.localStorage, { assertCurrent: () => assertCurrent(context.account.cacheKey) });
      assertCurrent(context.account.cacheKey);
      setBackup(reviewBackup(entry.raw, staged.review, true)); setArchives(stagedBrowserSnapshots(context.storage));
    } catch { setError(safeError); }
    finally { setBusy(false); }
  };
  const checkProject = async item => {
    setBusy(true); setError('');
    try {
      await currentAccount(context.account.cacheKey);
      let remote;
      try { remote = await request(`/api/cloud/projects/${encodeURIComponent(item.project.id)}`, null, context.account.cacheKey); }
      catch (failure) { if (failure.status !== 404) throw failure; }
      if (!remote) setComparisons(value => ({ ...value, [item.fingerprint]: 'No account copy with this identity.' }));
      else {
        const incoming = new Map(backup.review.snapshot.entries.filter(entry => entry.scope === 'account').map(entry => [entry.key, entry.value]));
        const result = await reconcileCloudProject({ getItem: key => incoming.get(key) ?? null }, item.project.id, remote);
        const identical = await projectDigest(remote.project) === item.fingerprint;
        setComparisons(value => ({ ...value, [item.fingerprint]: identical ? 'Already matches the account copy.' : result.conflict
          ? 'Conflicting browser and account edits. Both copies are preserved.' : 'Different from the account copy. Recovery will create a separate map.' }));
      }
    } catch { setError(safeError); }
    finally { setBusy(false); }
  };
  const saveCopy = async item => {
    setBusy(true); setError('');
    try {
      await currentAccount(context.account.cacheKey);
      // A deliberate account save with a new identity; never install an active
      // project, pending request, bearer link or sync baseline from the snapshot.
      const project = parseProject(serializeProject(item.project));
      project.id = `recovered_${crypto.randomUUID()}`;
      project.title = `${project.title} (recovered copy)`.slice(0, 500);
      project.sharingTier = 'private';
      const response = await fetch(appPath(`/api/cloud/projects/${project.id}`), { method: 'PUT', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { ...courseRequestHeaders(selection), 'x-systems-account-cache': context.account.cacheKey, 'content-type': 'application/json' },
        body: JSON.stringify({ project: serializeCloudProject(project), revision: 0 }) });
      if (!response.ok) throw new Error(safeError);
      assertCurrent(context.account.cacheKey);
      setSaved(value => ({ ...value, [item.fingerprint]: { id: project.id } }));
      setStatus('A separate private map was saved to your account. Its original and the browser backup remain available.');
    } catch { setError(safeError); }
    finally { setBusy(false); }
  };
  const applyPreference = async entry => {
    setBusy(true); setError('');
    try {
      await currentAccount(context.account.cacheKey); applyRecoveryPreference(entry, context.storage, window.localStorage);
      setBackup(value => ({ ...value, review: { ...value.review, comparisons: value.review.comparisons.map(candidate => candidate === entry ? { ...candidate, current: entry.value, status: 'same' } : candidate) } }));
      setStatus('Preference restored. Reload the destination workspace when ready.');
    }
    catch { setError('This preference could not be restored safely. Both copies remain in the recovery backup.'); }
    finally { setBusy(false); }
  };
  const restoreRelationships = async item => {
    setBusy(true); setError('');
    try {
      await currentAccount(context.account.cacheKey);
      const remote = await request(`/api/cloud/projects/${saved[item.fingerprint].id}`, null, context.account.cacheKey);
      assertCurrent(context.account.cacheKey);
      const count = restoreRecoveryRelationships(backup.raw, item.project, parseProject(remote.project), context.storage);
      setSaved(value => ({ ...value, [item.fingerprint]: { ...value[item.fingerprint], relationships: true } }));
      setStatus(`${count} relationship drafts restored to the new map on this device. Open that map to review and complete them.`);
    } catch { setError('Relationship drafts could not be restored safely. They remain in the private backup; any newer drafts are unchanged.'); }
    finally { setBusy(false); }
  };
  const privateBackup = () => download('systems-mapping-browser-recovery.json', JSON.stringify({ version: 1, raw: backup.raw,
    conflicts: backup.conflicts || backup.review.comparisons.filter(entry => entry.status === 'conflict').map(({ key, scope, current }) => ({ key, scope, value: current })) }));
  const verifiedDownload = async item => {
    setBusy(true); setError('');
    try {
      await currentAccount(context.account.cacheKey);
      assertCurrent(context.account.cacheKey);
      if (item) download('systems-mapping-private-map.json', serializeProject(item.project));
      else privateBackup();
    } catch { setError(safeError); }
    finally { setBusy(false); }
  };
  if (selection.kind === 'invalid') return <main><h1>Recover browser copies</h1><p>This course address is not valid. Open your workspace to choose a course.</p><a href={appPath('/')}>Open workspace</a></main>;
  if (unsupported) return <main className="account-page"><h1>Recover browser copies</h1><p role="status">{status}</p><a href={courseWorkspacePath('/', selection)}>Return to workspace</a></main>;
  return <main className="account-page browser-recovery" style={{ maxWidth: 820, margin: '2rem auto', padding: '1rem' }}>
    <h1>Recover browser copies</h1>
    <p>Your saved account maps already work at both addresses. Recover drafts and preferences saved only in this browser.</p>
    <p>Keep your original map tab open. Unfinished text in an open form, including a new node, must be saved or copied there before you close it.</p>
    <p role="status">{status}</p>{error && <p role="alert">{error}</p>}
    {!context && error && !unsupported && <a href={institutionalLoginUrl(selection)} target="_blank" rel="noopener noreferrer">Sign in to this address</a>}
    {context && <p>{context.account.course?.name || 'General workspace'}</p>}
    {mode === 'source' ? <>
      <p>This only reads saved browser copies. Your open maps remain unchanged.</p>
      <button type="button" disabled={!authorization || busy} onClick={readSource}>Read browser copies</button>
    </> : <>
      <button type="button" disabled={!context || busy} onClick={start}>Read copies from the other address</button>
      {archives.length > 0 && <details><summary>Saved browser backups ({archives.length})</summary><ul>{archives.map(entry => <li key={entry.key}>
        <button type="button" disabled={busy} onClick={() => reopen(entry)}>Review backup from {new Date(entry.receivedAt).toLocaleString()}</button>
      </li>)}</ul></details>}
      {backup && <section aria-label="Browser recovery review">
        <h2>Review browser backup</h2>
        <p>{backup.review.snapshot.entries.length} stored items; {backup.review.projects.length} readable map versions; {backup.review.comparisons.filter(entry => entry.status === 'conflict').length} browser conflicts.</p>
        <p>Both conflicting copies are kept. Unfinished requests will not restart. Saved sharing links stay in the private backup; recovered maps remain private. Memo edits appear as separate versions. You can restore unfinished relationships after saving a new map.</p>
        {backup.review.unreadable.length > 0 && <p>{backup.review.unreadable.length} map records could not be parsed. Their original bytes remain in the backup for recovery.</p>}
        <button type="button" disabled={busy} onClick={() => verifiedDownload()}>Download private browser backup</button>
        <ul>{backup.review.projects.map(item => <li key={item.fingerprint}>
          <h3>{item.project.title || 'Untitled systems map'}</h3><p>{item.variant} · {item.project.graph.nodes.length} nodes · {item.project.graph.edges.length} relationships</p>
          <p>{comparisons[item.fingerprint]}</p>
          <button type="button" disabled={busy} onClick={() => checkProject(item)}>Compare account copy</button>{' '}
          <button type="button" disabled={busy} onClick={() => verifiedDownload(item)}>Download private map</button>{' '}
          <button type="button" disabled={busy || !backup.persisted || saved[item.fingerprint]} onClick={() => saveCopy(item)}>{saved[item.fingerprint] ? 'Separate map saved' : 'Save as a separate account map'}</button>
          {saved[item.fingerprint] && recoverableRelationshipDrafts(backup.raw, item.project).length > 0 && <button type="button" disabled={busy || saved[item.fingerprint].relationships} onClick={() => restoreRelationships(item)}>Restore relationship drafts to the new map</button>}
        </li>)}</ul>
        <details><summary>Browser preferences</summary><ul>{backup.review.comparisons.filter(entry => ['systems-mapping.theme', 'systems-mapping.sidebar-width', 'systems-mapping.map-tools-width', 'account-navigation'].includes(entry.key)).map(entry => <li key={`${entry.scope}:${entry.key}`}>
          {entry.key === 'account-navigation' ? 'Account view' : entry.key.endsWith('theme') ? 'Theme' : entry.key.includes('sidebar') ? 'Sidebar width' : 'Map tools width'} ({entry.scope === 'account' ? 'account' : 'device'}) · {entry.status}{' '}
          <button type="button" disabled={busy || !backup.persisted || entry.status === 'same'} onClick={() => applyPreference(entry)}>Use incoming preference</button>
        </li>)}</ul></details>
      </section>}
    </>}
    <p>Private backups contain your memos and may contain saved sharing links. Keep them private.</p>
    <a href={courseWorkspacePath('/', selection)} target="_blank" rel="noopener noreferrer">Open workspace in a new tab</a>
  </main>;
}

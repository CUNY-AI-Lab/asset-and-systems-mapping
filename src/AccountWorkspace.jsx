import React, { useEffect, useRef, useState } from 'react';
import App, { AccessFrame, createBlankProject } from './App.jsx';
import { Action, Disclosure, EmptyState, LevelTrail, PageHeading, ProjectRow } from './ui/StudioPrimitives.jsx';
import { parseProject } from './domain.js';
import { saveProjectToLibrary, loadProjectLibrary } from './projectLibrary.js';
import { useAccountStorage, projectStorage, institutionalLoginUrl } from './accountStorage.js';
import { reconcileCloudProject, rememberCloudSave, serializeCloudProject } from './cloudSync.js';
import './account-workspace.css';

async function request(path, options) {
  const cacheKey = projectStorage().cacheKey;
  const response = await fetch(path, { credentials:'same-origin', ...options,
    headers: { ...(cacheKey ? { 'x-systems-account-cache': cacheKey } : {}), ...options?.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && cacheKey && ['authentication_required','session_invalid'].includes(data.details?.code)) window.location.assign(institutionalLoginUrl());
    throw Object.assign(new Error(data.error || 'Please try again.'), { status:response.status });
  }
  return data;
}

export default function AccountWorkspace() {
  const [dark, setDark] = useState(() => {
    try { return window.localStorage.getItem('systems-mapping.theme') === 'dark'; }
    catch { return document.documentElement.dataset.theme === 'dark'; }
  });
  const [account,setAccount] = useState(null);
  const [records,setRecords] = useState([]);
  const [active,setActive] = useState(null);
  const [teacher,setTeacher] = useState(false);
  const [status,setStatus] = useState('Loading your workspace…');
  const [error,setError] = useState('');
  const [signedOut,setSignedOut] = useState(false);
  const [busy,setBusy] = useState(false);
  const [quota,setQuota] = useState(null);
  const queue = useRef(Promise.resolve());
  const revisions = useRef(new Map());
  const saved = useRef(new Map());
  const blocked = useRef(new Set());
  const storageRef = useRef(null);
  const refresh = async () => {
    const remote = (await request('/api/cloud/projects')).projects;
    const local = loadProjectLibrary(storageRef.current, null, false);
    const records = [...remote, ...local.filter(record => !remote.some(saved => saved.id === record.id)).map(record => ({ ...record, localOnly: true }))];
    setRecords(records);
    return records;
  };

  useEffect(() => {
    const theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171717' : '#f8fafc');
    try { window.localStorage.setItem('systems-mapping.theme', theme); }
    catch { /* Theme remains usable when browser storage is unavailable. */ }
  }, [dark]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await request('/api/cloud/account');
        if (cancelled) return;
        storageRef.current = useAccountStorage(result.account.cacheKey, null);
        setAccount(result.account);
        const records = await refresh();
        try { const data = await request('/api/cloud/quota'); if (!cancelled) setQuota(data.quota); } catch { /* Informational only; map editing stays available. */ }
        if (cancelled) return;
        setStatus('');
        const token = /^\/p\/([A-Za-z0-9_-]{20,64})\/?$/.exec(window.location.pathname)?.[1];
        if (token) {
          const linked = await request(`/api/projects/${token}`);
          if (cancelled) return;
          const project = parseProject(linked.project);
          if (linked.projectId && linked.projectId !== project.id) throw new Error('The project link does not match its saved map.');
          await open(records.find(record => record.id === project.id) || { id: project.id, localOnly: true }, result.account, project);
        }
      } catch (failure) {
        if (cancelled) return;
        setSignedOut(failure.status === 401);
        setStatus('');
        if (failure.status !== 401) setError(failure.message);
      }
    })();
    // Keep the adapter alive while child cleanup flushes pending edits.
    return () => { cancelled = true; };
  }, []);

  const persist = (project) => {
    const serialized = serializeCloudProject(project);
    if (blocked.current.has(project.id) || saved.current.get(project.id) === serialized) return;
    setStatus('Saving to your account…');
    queue.current = queue.current.then(async () => {
      if (blocked.current.has(project.id) || saved.current.get(project.id) === serialized) return;
      try {
        const result = await request(`/api/cloud/projects/${encodeURIComponent(project.id)}`, {
          method:'PUT', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({project:serialized,revision:revisions.current.get(project.id) || 0}),
        });
        revisions.current.set(project.id,result.revision);
        saved.current.set(project.id,serialized);
        await rememberCloudSave(storageRef.current, project.id, result.revision, serialized);
        setStatus('Saved to your account');
      } catch (failure) {
        blocked.current.add(project.id);
        setError(`${failure.message} Your unsynced copy remains on this device. Export it before reloading.`);
        setStatus('Not saved to your account');
      }
    });
  };

  const open = async (record, workspaceAccount = account, linkedProject = null) => {
    setBusy(true); setError('');
    try {
      const result = record && !record.localOnly ? await request(`/api/cloud/projects/${encodeURIComponent(record.id)}`) : null;
      const storage = useAccountStorage(workspaceAccount.cacheKey, null);
      const reconciled = record ? await reconcileCloudProject(storage, record.id, result) : { project: createBlankProject(), conflict: false };
      const project = reconciled.project || linkedProject;
      if (!project) throw new Error('The saved device copy is unavailable.');
      revisions.current.set(project.id,result?.revision || 0);
      if (result) {
        const remote = serializeCloudProject(parseProject(result.project));
        saved.current.set(project.id,remote);
        if (!reconciled.conflict) await rememberCloudSave(storage, project.id, result.revision, remote);
      }
      if (reconciled.conflict) {
        blocked.current.add(project.id);
        setError('This map has different changes on this device and in your account. Your device copy is open for recovery export; it will not overwrite the account copy.');
        setStatus('Not saved to your account');
      } else blocked.current.delete(project.id);
      // Each account gets a separate browser cache. A different login
      // never inherits another person's draft or project catalog.
      saveProjectToLibrary(storage,project,loadProjectLibrary(storage, project, false),{makeActive:true});
      storageRef.current = useAccountStorage(workspaceAccount.cacheKey,persist);
      if (!reconciled.conflict) persist(project);
      setActive(project.id);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  const dashboard = async () => {
    setBusy(true);
    // Force the app's ordinary pending-edit flush before leaving its view.
    window.dispatchEvent(new Event('pagehide'));
    await queue.current;
    if (blocked.current.size === 0) {
      window.history.replaceState(null, '', '/');
      setActive(null);
      setTeacher(false);
      try { setDark(document.documentElement.dataset.theme === 'dark'); }
      catch { /* Preserve the current theme when browser storage is unavailable. */ }
      try { await refresh(); } catch (failure) { setError(failure.message); }
    }
    setBusy(false);
  };

  if (active) return <App key={active} startInWorkspace onAccountDashboard={dashboard} cloudSaveStatus={status} cloudError={error} />;
  if (teacher) return <App startInTeacher onAccountDashboard={dashboard} />;
  return <AccessFrame dark={dark} onToggleTheme={() => setDark(value => !value)} onTeacher={account?.role === 'instructor' ? () => setTeacher(true) : undefined}>
    <main id="workspace" className={signedOut ? 'access-main account-workspace' : 'studio-dashboard account-workspace'}>
      {signedOut ? <>
        <PageHeading title="Systems Mapping" description="Map how people, settings, and decisions connect" />
        <LevelTrail />
        <Action as="a" href={institutionalLoginUrl()}>CUNY Login</Action>
      </> : account ? <>
        <PageHeading title="Projects" description="Continue a map or start a new one" actions={records.length ? <Action disabled={busy} onClick={() => open(null)}>New project</Action> : null} />
        {records.length ? <div className="studio-projects" aria-label="Saved projects">{records.map(record => <ProjectRow key={record.id} title={record.title || 'Untitled systems map'} subtitle={record.localOnly ? 'Device copy' : undefined} detail={`Updated ${new Date(record.updatedAt).toLocaleString()}`} disabled={busy} onOpen={() => open(record)} />)}</div>
          : <EmptyState title="Start your first map" description="Begin with a memo" action={<Action disabled={busy} onClick={() => open(null)}>New project</Action>} />}
        <Disclosure title="Account" className="account-details">
          <p>Model usage {quota ? `approximately ${quota.remaining_percent}% remaining` : 'unavailable'}</p>
          <form action="/auth/logout" method="post"><Action variant="ghost" type="submit">Sign out</Action></form>
        </Disclosure>
      </> : <p role="status">{status}</p>}
      {error && <p role="alert" className="account-error">{error}</p>}
    </main>
  </AccessFrame>;
}

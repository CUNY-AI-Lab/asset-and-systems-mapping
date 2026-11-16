import React, { useCallback, useEffect, useRef, useState } from 'react';
import App, { AccessFrame, createBlankProject } from './App.jsx';
import { Action, EmptyState, LevelTrail, PageHeading } from './ui/StudioPrimitives.jsx';
import { exportFileName, parseProject, serializePortableProject } from './domain.js';
import { saveProjectToLibrary, loadProjectLibrary, removeLibraryProject } from './projectLibrary.js';
import { deletedProjects, forgetDeletedProject, preserveDeletedProject } from './projectRecovery.js';
import { downloadBlob } from './mapExport.js';
import SavedProjects from './SavedProjects.jsx';
import ProjectLibraryDialog from './ProjectLibraryDialog.jsx';
import { projectStorage, releaseAccountStorage, setProjectSavedHandler, useAccountStorage, institutionalLoginUrl } from './accountStorage.js';
import { forgetCloudSave, reconcileCloudProject, rememberCloudSave, serializeCloudProject } from './cloudSync.js';
import { apiRequest, ApiError } from './api.js';
import { courseWorkspacePath, instructorWorkspacePath, parseCourseSelection, parseWorkspaceView } from './courseContext.js';
import { userFacingError } from './userFacingError.js';
import AccountDashboard from './AccountDashboard.jsx';
import NollSketch from './NollSketch.jsx';
import './account-workspace.css';
import { appPathname } from './appPath.js';
import { createWorkspaceStateSync } from './workspaceState.js';

const CLOUD_SAVE_ATTEMPTS = 3;
const CLOUD_SAVE_RETRY_DELAYS = [250, 750];
const CLOUD_SAVE_REQUEST_TIMEOUT_MS = 15000;
const TRANSIENT_SAVE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const transientSaveFailure = failure => failure?.status == null || TRANSIENT_SAVE_STATUSES.has(failure.status);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function saveRequestWithDeadline(request, path, options, storage) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const failure = Object.assign(new Error('Account save request timed out'), { name: 'TimeoutError' });
      reject(failure);
      controller.abort(failure);
    }, CLOUD_SAVE_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request(path, { ...options, signal: controller.signal }, storage), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export default function AccountWorkspace() {
  const [courseSelection] = useState(() => parseCourseSelection(window.location.search));
  const [instructorRequested] = useState(() => appPathname() === '/' && parseWorkspaceView(window.location.search) === 'instructor');
  const [dark, setDark] = useState(() => {
    try { return window.localStorage.getItem('systems-mapping.theme') === 'dark'; }
    catch { return document.documentElement.dataset.theme === 'dark'; }
  });
  const [account,setAccount] = useState(null);
  const [records,setRecords] = useState([]);
  const [newTitle,setNewTitle] = useState('');
  const [creatorName,setCreatorName] = useState('');
  const [active,setActive] = useState(null);
  const [accountView,setAccountView] = useState({open:false,tab:'overview'});
  const [configurationRevision,setConfigurationRevision] = useState(0);
  const [selection,setSelection] = useState(null);
  const [recoveries,setRecoveries] = useState([]);
  const [status,setStatus] = useState('Loading your workspace…');
  const [error,setError] = useState('');
  const [signedOut,setSignedOut] = useState(false);
  const [cloudSaveError,setCloudSaveError] = useState('');
  const [retryProjectId,setRetryProjectId] = useState(null);
  const [busy,setBusy] = useState(false);
  const [quota,setQuota] = useState(null);
  const [courses,setCourses] = useState([]);
  const [courseError,setCourseError] = useState('');
  const queue = useRef(Promise.resolve());
  const revisions = useRef(new Map());
  const saved = useRef(new Map());
  const blocked = useRef(new Set());
  const retryable = useRef(new Set());
  const rejectedPayloads = useRef(new Map());
  const latestProjects = useRef(new Map());
  const deletingProjects = useRef(new Set());
  const deletedProjectsRef = useRef(new Set());
  const saveGeneration = useRef(new Map());
  const activeProjectId = useRef(null);
  const storageRef = useRef(null);
  const workspaceStateSync = useRef(null);
  const request = useCallback((path, options, storage = storageRef.current) => apiRequest(path, {
    ...options,
    workspace: storage || { courseSelection },
  }), [courseSelection]);
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
    try { storageRef.current?.setItem('systems-mapping.theme', theme); }
    catch { /* Private preference sync is best-effort; local rendering remains available. */ }
  }, [dark]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await request('/api/cloud/account');
        if (cancelled) return;
        if ((courseSelection.kind === 'course' && result.account.course?.id !== courseSelection.id)
          || (courseSelection.kind === 'general' && result.account.course)) {
          throw new ApiError('Workspace scope unavailable', 503, { details: { code: 'course_access_unavailable' } });
        }
        let suppressStateWrites = true;
        let storage;
        let sync;
        storage = useAccountStorage(result.account.cacheKey, null, courseSelection, (key, value) => {
          if (!suppressStateWrites && storageRef.current === storage) sync?.write(key, value);
        });
        storageRef.current = storage;
        sync = createWorkspaceStateSync(storage, request, captured => !cancelled
          && storageRef.current === captured
          && JSON.stringify(captured.courseSelection) === JSON.stringify(courseSelection));
        workspaceStateSync.current?.close();
        workspaceStateSync.current = sync;
        try { await sync.hydrate(); } catch (failure) {
          if (cancelled || storageRef.current !== storage) return;
          if ([401, 403, 409].includes(failure?.status)) {
            sync.close(); workspaceStateSync.current = null; storageRef.current = null; releaseAccountStorage();
            throw failure;
          }
          /* Local drafts and preferences remain available if private sync is offline. */
        }
        suppressStateWrites = false;
        if (cancelled || storageRef.current !== storage) return;
        const savedTheme = storage.getItem('systems-mapping.theme');
        if (savedTheme === 'dark' || savedTheme === 'light') setDark(savedTheme === 'dark');
        setRecoveries(deletedProjects(storageRef.current));
        setAccount(result.account);
        setCreatorName(result.account.preferredName?.trim() || '');
        let remembered;
        try { remembered = JSON.parse(storageRef.current.getItem('account-navigation')); } catch { /* Start with Overview if UI state is unavailable. */ }
        const requested = instructorRequested && result.account.role === 'instructor';
        setAccountView({open: requested || remembered?.open === true, tab: result.account.role === 'instructor' && (requested || remembered?.tab === 'instructor') ? 'instructor' : 'overview'});
        if (courseSelection.kind === 'general') {
          void request('/api/cloud/courses')
            .then(page => { if (!cancelled) setCourses(page.courses); })
            .catch(failure => { if (!cancelled) setCourseError(userFacingError(failure, 'Your courses are temporarily unavailable. Reload to check again.')); });
        }
        const records = await refresh();
        try { const data = await request('/api/cloud/quota'); if (!cancelled) setQuota(data.quota); } catch { /* Informational only; map editing stays available. */ }
        if (cancelled) return;
        setStatus('');
        const token = /^\/p\/([A-Za-z0-9_-]{20,64})\/?$/.exec(appPathname())?.[1];
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
        if (failure.status !== 401) setError(userFacingError(failure, 'Your workspace could not be loaded. Reload to try again.'));
      }
    })();
    // Keep the adapter alive while child cleanup flushes pending edits.
    return () => { cancelled = true; workspaceStateSync.current?.close(); workspaceStateSync.current = null; };
  }, []);

  const persist = (project, capturedStorage = storageRef.current) => {
    if (deletingProjects.current.has(project.id) || deletedProjectsRef.current.has(project.id)) return;
    const storage = capturedStorage;
    const serialized = serializeCloudProject(project);
    const generation = saveGeneration.current.get(project.id) || 0;
    latestProjects.current.set(project.id, { project, storage });
    if (blocked.current.has(project.id) || rejectedPayloads.current.get(project.id) === serialized || saved.current.get(project.id) === serialized) return;
    retryable.current.delete(project.id);
    setRetryProjectId(current => current === project.id ? null : current);
    if (activeProjectId.current === project.id) {
      setCloudSaveError('');
      setStatus('Saving to your account…');
    }
    queue.current = queue.current.then(async () => {
      if ((saveGeneration.current.get(project.id) || 0) !== generation || blocked.current.has(project.id) || rejectedPayloads.current.get(project.id) === serialized || saved.current.get(project.id) === serialized) return;
      let failure;
      for (let attempt = 0; attempt < CLOUD_SAVE_ATTEMPTS; attempt += 1) {
        if ((saveGeneration.current.get(project.id) || 0) !== generation || blocked.current.has(project.id)) return;
        try {
          const result = await saveRequestWithDeadline(request, `/api/cloud/projects/${encodeURIComponent(project.id)}`, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({project:serialized,revision:revisions.current.get(project.id) || 0}),
          }, storage);
          if ((saveGeneration.current.get(project.id) || 0) !== generation) return;
          revisions.current.set(project.id,result.revision);
          saved.current.set(project.id,serialized);
          rejectedPayloads.current.delete(project.id);
          try { await rememberCloudSave(storage, project.id, result.revision, serialized); } catch { /* The account accepted the project; local sync metadata is only a cache. */ }
          retryable.current.delete(project.id);
          setRetryProjectId(current => current === project.id ? null : current);
          if (activeProjectId.current === project.id) {
            setCloudSaveError('');
            setStatus('Saved to your account');
          }
          return;
        } catch (error) {
          if ((saveGeneration.current.get(project.id) || 0) !== generation) return;
          failure = error;
          if (failure.status === 409) {
            // A response can be lost after the server commits. Confirm that
            // exact payload with a read; never retry a divergent revision.
            try {
              const remote = await saveRequestWithDeadline(request, `/api/cloud/projects/${encodeURIComponent(project.id)}`, {}, storage);
              if ((saveGeneration.current.get(project.id) || 0) !== generation) return;
              if (remote.revision >= (revisions.current.get(project.id) || 0)
                && serializeCloudProject(parseProject(remote.project)) === serialized) {
                revisions.current.set(project.id, remote.revision);
                saved.current.set(project.id, serialized);
                rejectedPayloads.current.delete(project.id);
                try { await rememberCloudSave(storage, project.id, remote.revision, serialized); } catch { /* The read confirms the account already has this exact project. */ }
                retryable.current.delete(project.id);
                setRetryProjectId(current => current === project.id ? null : current);
                if (activeProjectId.current === project.id) {
                  setCloudSaveError('');
                  setStatus('Saved to your account');
                }
                return;
              }
            } catch { /* Keep the local version and treat an unverified 409 as a conflict. */ }
          }
          if (!transientSaveFailure(failure)) {
            if ([400, 413, 422].includes(failure.status)) rejectedPayloads.current.set(project.id, serialized);
            else blocked.current.add(project.id);
            retryable.current.delete(project.id);
            setRetryProjectId(current => current === project.id ? null : current);
            if (activeProjectId.current === project.id) {
              setCloudSaveError(failure.status === 409
                ? 'This map changed separately in your account. The account version was kept; this device version did not replace it.'
                : userFacingError(failure, 'This map could not be saved to your account.'));
              setStatus('Account save needs attention');
            }
            return;
          }
          if (attempt < CLOUD_SAVE_ATTEMPTS - 1) await wait(CLOUD_SAVE_RETRY_DELAYS[attempt]);
        }
      }
      retryable.current.add(project.id);
      if (activeProjectId.current === project.id) {
        setRetryProjectId(project.id);
        setCloudSaveError('This map is saved on this device. Its account save is still pending.');
        setStatus('Account save pending');
      }
    });
  };

  const retryCloudSave = () => {
    const id = retryProjectId;
    const latest = id && latestProjects.current.get(id);
    if (!latest || !retryable.current.has(id)) return;
    retryable.current.delete(id);
    setRetryProjectId(null);
    persist(latest.project, latest.storage);
  };

  const open = async (record, workspaceAccount = account, linkedProject = null) => {
    setBusy(true); setError('');
    try {
      const result = record && !record.localOnly ? await request(`/api/cloud/projects/${encodeURIComponent(record.id)}`) : null;
      const storage = storageRef.current;
      if (!storage || projectStorage() !== storage || storage.cacheKey !== workspaceAccount.cacheKey
        || JSON.stringify(storage.courseSelection) !== JSON.stringify(courseSelection)) {
        throw new Error('Your workspace changed. Reload before opening this map.');
      }
      const ownsStorageScope = () => storageRef.current === storage && projectStorage() === storage
        && storage.cacheKey === workspaceAccount.cacheKey
        && JSON.stringify(storage.courseSelection) === JSON.stringify(courseSelection);
      const reconciled = record ? await reconcileCloudProject(storage, record.id, result) : { project: createBlankProject(), conflict: false };
      if (!ownsStorageScope()) throw new Error('Your workspace changed. Reload before opening this map.');
      const project = reconciled.project || linkedProject;
      if (!project) throw new Error('The saved device copy is unavailable.');
      // Creation details are separate: a person's name is not the project title.
      if (!record && !linkedProject) {
        project.title = newTitle.trim() || 'Untitled systems map';
        project.participantName = creatorName.trim();
      }
      revisions.current.set(project.id,result?.revision || 0);
      if (result) {
        const remote = serializeCloudProject(parseProject(result.project));
        saved.current.set(project.id,remote);
        if (!reconciled.conflict) await rememberCloudSave(storage, project.id, result.revision, remote);
        if (!ownsStorageScope()) throw new Error('Your workspace changed. Reload before opening this map.');
      }
      if (reconciled.conflict) {
        blocked.current.add(project.id);
        setCloudSaveError('This map changed separately in your account. The account version was kept; this device version did not replace it.');
        setStatus('Not saved to your account');
      } else blocked.current.delete(project.id);
      // Each account gets a separate browser cache. A different login
      // never inherits another person's draft or project catalog.
      saveProjectToLibrary(storage,project,loadProjectLibrary(storage, project, false),{makeActive:true});
      activeProjectId.current = project.id;
      deletedProjectsRef.current.delete(project.id);
      setRetryProjectId(retryable.current.has(project.id) ? project.id : null);
      if (!reconciled.conflict && !retryable.current.has(project.id)) setCloudSaveError('');
      const scopedStorage = storage;
      if (!setProjectSavedHandler(scopedStorage, latest => persist(latest, scopedStorage))) {
        throw new Error('Your workspace changed. Reload before opening this map.');
      }
      if (!reconciled.conflict) persist(project, scopedStorage);
      setActive(project.id);
      if (!record && !linkedProject) setNewTitle('');
      navigateAccount({open:false});
    } catch (failure) { setError(userFacingError(failure, 'This map could not be opened. Return to Projects and try again.')); }
    finally { setBusy(false); }
  };

  const submitRevision = async (project) => {
    const storage = storageRef.current;
    const serialized = serializeCloudProject(project);
    persist(project, storage);
    await queue.current;
    if (blocked.current.has(project.id) || saved.current.get(project.id) !== serialized) throw new Error('Finish saving this map before submitting its revision.');
    return request(`/api/cloud/projects/${encodeURIComponent(project.id)}/submitted-revisions`, {
      method: 'POST', body: { revision: revisions.current.get(project.id) },
    }, storage);
  };

  const dashboard = async () => {
    setBusy(true);
    // Force the app's ordinary pending-edit flush before leaving its view.
    window.dispatchEvent(new Event('pagehide'));
    await queue.current;
    if (blocked.current.size === 0) {
      window.history.replaceState(null, '', courseWorkspacePath('/', courseSelection));
      setActive(null);
      navigateAccount({open:false});
      try { setDark(document.documentElement.dataset.theme === 'dark'); }
      catch { /* Preserve the current theme when browser storage is unavailable. */ }
      try { await refresh(); } catch (failure) { setError(userFacingError(failure, 'Your project list could not be loaded. Reload to try again.')); }
    }
    setBusy(false);
  };

  function navigateAccount(changes) {
    setAccountView(current => {
      const next = {...current,...changes};
      if (account?.role !== 'instructor') next.tab = 'overview';
      try { storageRef.current?.setItem('account-navigation',JSON.stringify(next)); } catch { /* Navigation remains usable without device storage. */ }
      return next;
    });
  }
  const showAccount = async () => {
    setBusy(true); setError('');
    window.dispatchEvent(new Event('pagehide'));
    await queue.current;
    try {
      const result = await request('/api/cloud/account');
      if (result.account.cacheKey !== account.cacheKey || (result.account.course?.id || null) !== (account.course?.id || null)) {
        setActive(null); setAccount(null); setSignedOut(true);
        throw new Error('The signed-in account changed. Reload to open its workspace. Your device copy is preserved.');
      }
      setAccount(result.account);
      setDark(document.documentElement.dataset.theme === 'dark');
      navigateAccount({open:true,...(result.account.role !== 'instructor' ? {tab:'overview'} : {})});
      setQuota(null);
      try { setQuota((await request('/api/cloud/quota')).quota); } catch { /* Do not substitute stale or invented usage. */ }
    } catch (failure) {
      if (failure.status === 401 || failure.status === 403) { setActive(null); setAccount(null); setSignedOut(true); }
      setError(userFacingError(failure,'Account could not be opened. Your map remains on this device. Try again.'));
    } finally { setBusy(false); }
  };
  const returnFromAccount = () => {
    window.history.replaceState(null,'',courseWorkspacePath('/',courseSelection));
    navigateAccount({open:false});
    requestAnimationFrame(()=>document.querySelector('.account-nav-button')?.focus());
  };
  const inspect = async (record, mode) => {
    setBusy(true); setError('');
    try {
      const remote = record.localOnly ? null : await request(`/api/cloud/projects/${encodeURIComponent(record.id)}`);
      const reconciled = await reconcileCloudProject(storageRef.current, record.id, remote);
      if (!reconciled.project || reconciled.project.id !== record.id) throw new Error('This saved project could not be read.');
      setSelection({record,mode,...reconciled,revision:remote?.revision || 0,remote:remote ? parseProject(remote.project) : null});
    } catch (failure) { setError(userFacingError(failure,'This project could not be read. Try again.')); }
    finally { setBusy(false); }
  };
  const saveNotes = async (project, revision) => {
    // The dialog opened the current remote revision. Never turn a stale note
    // edit into an unconditional overwrite of another tab's graph or memo.
    revisions.current.set(project.id, revision);
    blocked.current.delete(project.id);
    const storage = storageRef.current;
    saveProjectToLibrary(storage,project,loadProjectLibrary(storage,null,false));
    persist(project, storage);
    await queue.current;
    if (blocked.current.has(project.id) || saved.current.get(project.id) !== serializeCloudProject(project)) throw new Error('The account save did not finish. Try saving the note again.');
    setSelection(current => current?.project.id === project.id ? {...current,revision:revisions.current.get(project.id)} : current);
    await refresh();
  };
  const deleteSaved = async selected => {
    const storage = storageRef.current;
    const projectId = selected.project.id;
    preserveDeletedProject(storage,selected.project,selected.conflict ? selected.remote : null);
    setRecoveries(deletedProjects(storage));
    saveGeneration.current.set(projectId,(saveGeneration.current.get(projectId) || 0) + 1);
    deletingProjects.current.add(projectId);
    blocked.current.add(projectId);
    try {
      await queue.current;
      if (!selected.record.localOnly) await request(`/api/cloud/projects/${encodeURIComponent(projectId)}`,{method:'DELETE',body:{revision:selected.revision}},storage);
    } catch (failure) {
      blocked.current.delete(projectId);
      deletingProjects.current.delete(projectId);
      throw failure;
    }
    deletingProjects.current.delete(projectId);
    deletedProjectsRef.current.add(projectId);
    removeLibraryProject(storage,projectId);
    forgetCloudSave(storage,projectId);
    revisions.current.delete(projectId); saved.current.delete(projectId); blocked.current.delete(projectId);
    rejectedPayloads.current.delete(projectId);
    retryable.current.delete(projectId); latestProjects.current.delete(projectId);
    setRetryProjectId(current => current === projectId ? null : current);
    if (activeProjectId.current === projectId) setCloudSaveError('');
    await refresh();
  };
  const restoreDeleted = async entry => {
    setBusy(true); setError('');
    try {
      const storage = storageRef.current;
      const project = parseProject(entry.project);
      const result = await request(`/api/cloud/projects/${encodeURIComponent(project.id)}`,{method:'PUT',body:{project:serializeCloudProject(project),revision:0}},storage);
      deletedProjectsRef.current.delete(project.id);
      revisions.current.set(project.id,result.revision);
      saved.current.set(project.id,serializeCloudProject(project));
      blocked.current.delete(project.id);
      saveProjectToLibrary(storage,project,loadProjectLibrary(storage,null,false));
      await rememberCloudSave(storage,project.id,result.revision,serializeCloudProject(project));
      // A divergent account copy has its own retained recovery and can still be
      // downloaded; restoring one version must not silently drop the other.
      if (!entry.remoteProject) forgetDeletedProject(storage,entry.key);
      setRecoveries(deletedProjects(storage));
      await refresh();
    } catch (failure) { setError(userFacingError(failure,'This recovery could not be restored. An existing project will not be overwritten. Download the recovery instead.')); }
    finally { setBusy(false); }
  };
  const downloadRecovery = (entry,remote=false) => {
    try {
      const project = parseProject(remote ? entry.remoteProject : entry.project);
      downloadBlob(new Blob([serializePortableProject(project,'private')],{type:'application/json'}),exportFileName(project,'json','recovery'));
    } catch (failure) { setError(userFacingError(failure,'This recovery could not be downloaded. The saved bytes remain on this device.')); }
  };
  return <>
    {active && <div hidden={accountView.open} className="account-project-view"><App key={active} memoFirstWorkflow startInWorkspace onAccountDashboard={dashboard} onOpenAccount={showAccount} configurationRevision={configurationRevision} cloudSaveStatus={status} cloudError={cloudSaveError} cloudSaveCanRetry={retryProjectId === active} onRetryCloudSave={retryCloudSave} onSubmitRevision={account?.course && account.role === 'student' ? submitRevision : undefined} /></div>}
    <div hidden={Boolean(active) && !accountView.open} className="account-shell-view"><AccessFrame dark={dark} onToggleTheme={() => setDark(value => !value)} headerActions={account && !signedOut ? <><Action variant="secondary" className="account-nav-button" aria-current={accountView.open ? 'page' : undefined} onClick={showAccount}>Account</Action><form className="header-sign-out" method="post" action="/auth/logout"><Action variant="ghost" type="submit">Sign out</Action></form></> : null}>
    <main id="account-workspace" className={signedOut ? 'access-main account-workspace account-landing' : 'studio-dashboard account-workspace'}>
      {signedOut ? <>
        <div className="account-landing__hero">
          <PageHeading title="Systems Mapping" description="Map how people, settings, and decisions connect" />
          <LevelTrail />
          <Action as="a" className="account-login" href={institutionalLoginUrl(courseSelection, { landing: true })}>CUNY Login</Action>
        </div>
        <NollSketch className="account-landing__noll" />
      </> : account ? <>
        <div hidden={accountView.open}>
        <PageHeading title="Projects" description={account.course ? `${account.course.name} · ${account.course.term} · ${account.course.section}` : undefined} />
        <form className="project-create" aria-label="New project" onSubmit={event => {event.preventDefault(); void open(null);}}>
          <label className="field"><span>Project</span><input aria-label="Project" value={newTitle} onChange={event=>setNewTitle(event.target.value)} maxLength={160} placeholder="Name your map" /></label>
          <label className="field"><span>Name</span><input aria-label="Name" value={creatorName} onChange={event=>setCreatorName(event.target.value)} maxLength={160} autoComplete="name" placeholder="Name or group" /></label>
          <Action type="submit" disabled={busy}>New project</Action>
        </form>
        {records.length > 0 && <SavedProjects simple records={records} busy={busy} onOpen={open} onInspect={inspect} onDelete={record=>inspect(record,'delete')} />}
        {recoveries.length > 0 && <details className="project-recoveries"><summary>Project recovery ({recoveries.length})</summary><p>Private copies saved on this device before deletion.</p><ul>{recoveries.map(entry=><li key={entry.key}><span>{entry.title}</span><div className="button-row"><Action variant="secondary" disabled={busy} onClick={()=>restoreDeleted(entry)}>Restore</Action><Action variant="ghost" disabled={busy} onClick={()=>downloadRecovery(entry)}>Download</Action>{entry.remoteProject && <Action variant="ghost" disabled={busy} onClick={()=>downloadRecovery(entry,true)}>Account backup</Action>}</div></li>)}</ul></details>}
        <NollSketch className="noll-sketch--page" />
        </div>
        <div hidden={!accountView.open}><AccountDashboard key={account.cacheKey} account={account} courses={courses} courseError={courseError} quota={quota} tab={accountView.tab} onTab={tab=>{
          navigateAccount({tab});
          window.history.replaceState(null,'',tab==='instructor' && account.role==='instructor' ? instructorWorkspacePath(courseSelection) : courseWorkspacePath('/',courseSelection));
        }} active={accountView.open} request={request} onReturn={returnFromAccount} returnLabel={active ? 'Return to map' : 'Projects'} onConfigurationChanged={()=>setConfigurationRevision(value=>value+1)} /></div>
      </> : <p role="status">{status}</p>}
      {error && <p role="alert" className="account-error">{error}</p>}
      {cloudSaveError && <p role="alert" className="account-error">{cloudSaveError}{retryProjectId && accountView.open && <button type="button" className="button button--secondary" onClick={retryCloudSave}>Try saving again</button>}</p>}
    </main>
  </AccessFrame></div>{selection && <ProjectLibraryDialog key={`${selection.record.id}:${selection.mode}`} selection={selection} onClose={()=>setSelection(null)} onSave={saveNotes} onDelete={deleteSaved} onOpen={record=>{setSelection(null);void open(record);}} />}</>;
}

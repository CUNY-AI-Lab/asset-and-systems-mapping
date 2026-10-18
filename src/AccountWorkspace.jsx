import React, { useCallback, useEffect, useRef, useState } from 'react';
import App, { AccessFrame, createBlankProject } from './App.jsx';
import { Action, Disclosure, EmptyState, LevelTrail, PageHeading, ProjectRow } from './ui/StudioPrimitives.jsx';
import { parseProject } from './domain.js';
import { saveProjectToLibrary, loadProjectLibrary } from './projectLibrary.js';
import { useAccountStorage, institutionalLoginUrl } from './accountStorage.js';
import { reconcileCloudProject, rememberCloudSave, serializeCloudProject } from './cloudSync.js';
import { apiRequest, ApiError } from './api.js';
import { courseWorkspacePath, parseCourseSelection } from './courseContext.js';
import { userFacingError } from './userFacingError.js';
import CoursePromptEditor from './CoursePromptEditor.jsx';
import NollSketch from './NollSketch.jsx';
import './account-workspace.css';

export default function AccountWorkspace() {
  const [courseSelection] = useState(() => parseCourseSelection(window.location.search));
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
  const [courses,setCourses] = useState([]);
  const [courseError,setCourseError] = useState('');
  const queue = useRef(Promise.resolve());
  const revisions = useRef(new Map());
  const saved = useRef(new Map());
  const blocked = useRef(new Set());
  const storageRef = useRef(null);
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
        storageRef.current = useAccountStorage(result.account.cacheKey, null, courseSelection);
        setAccount(result.account);
        const records = await refresh();
        if (courseSelection.kind === 'general') {
          void request('/api/cloud/courses')
            .then(page => { if (!cancelled) setCourses(page.courses); })
            .catch(failure => { if (!cancelled) setCourseError(userFacingError(failure, 'Your courses are temporarily unavailable. Reload to check again.')); });
        }
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
        if (failure.status !== 401) setError(userFacingError(failure, 'Your workspace could not be loaded. Reload to try again.'));
      }
    })();
    // Keep the adapter alive while child cleanup flushes pending edits.
    return () => { cancelled = true; };
  }, []);

  const persist = (project) => {
    const storage = storageRef.current;
    const serialized = serializeCloudProject(project);
    if (blocked.current.has(project.id) || saved.current.get(project.id) === serialized) return;
    setStatus('Saving to your account…');
    queue.current = queue.current.then(async () => {
      if (blocked.current.has(project.id) || saved.current.get(project.id) === serialized) return;
      try {
        const result = await request(`/api/cloud/projects/${encodeURIComponent(project.id)}`, {
          method:'PUT', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({project:serialized,revision:revisions.current.get(project.id) || 0}),
        }, storage);
        revisions.current.set(project.id,result.revision);
        saved.current.set(project.id,serialized);
        await rememberCloudSave(storage, project.id, result.revision, serialized);
        setStatus('Saved to your account');
      } catch (failure) {
        blocked.current.add(project.id);
        setError(`${userFacingError(failure, 'Your map could not be saved to your account.')} Your unsynced copy remains on this device. Export it before reloading.`);
        setStatus('Not saved to your account');
      }
    });
  };

  const open = async (record, workspaceAccount = account, linkedProject = null) => {
    setBusy(true); setError('');
    try {
      const result = record && !record.localOnly ? await request(`/api/cloud/projects/${encodeURIComponent(record.id)}`) : null;
      const storage = useAccountStorage(workspaceAccount.cacheKey, null, courseSelection);
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
      storageRef.current = useAccountStorage(workspaceAccount.cacheKey,persist,courseSelection);
      if (!reconciled.conflict) persist(project);
      setActive(project.id);
    } catch (failure) { setError(userFacingError(failure, 'This map could not be opened. Return to Projects and try again.')); }
    finally { setBusy(false); }
  };

  const submitRevision = async (project) => {
    const storage = storageRef.current;
    const serialized = serializeCloudProject(project);
    persist(project);
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
      setTeacher(false);
      try { setDark(document.documentElement.dataset.theme === 'dark'); }
      catch { /* Preserve the current theme when browser storage is unavailable. */ }
      try { await refresh(); } catch (failure) { setError(userFacingError(failure, 'Your project list could not be loaded. Reload to try again.')); }
    }
    setBusy(false);
  };

  if (active) return <App key={active} startInWorkspace onAccountDashboard={dashboard} cloudSaveStatus={status} cloudError={error} onSubmitRevision={account?.course && account.role === 'student' ? submitRevision : undefined} />;
  if (teacher) return <App startInTeacher onAccountDashboard={dashboard} />;
  return <AccessFrame dark={dark} onToggleTheme={() => setDark(value => !value)} onTeacher={account?.role === 'instructor' ? () => setTeacher(true) : undefined}>
    <main id="workspace" className={signedOut ? 'access-main account-workspace account-landing' : 'studio-dashboard account-workspace'}>
      {signedOut ? <>
        <div className="account-landing__hero">
          <PageHeading title="Systems Mapping" description="Map how people, settings, and decisions connect" />
          <LevelTrail />
          <Action as="a" className="account-login" href={institutionalLoginUrl(courseSelection)}>CUNY Login</Action>
        </div>
        <NollSketch className="account-landing__noll" />
      </> : account ? <>
        {courses.length > 0 && <section aria-labelledby="your-courses"><h2 id="your-courses">Your courses</h2><ul>{courses.map(course => <li key={course.id}><a href={courseWorkspacePath('/', { kind: 'course', id: course.id })}>{course.name} · {course.term} · {course.section}</a>{course.role === 'instructor' && <span> · Instructor</span>}</li>)}</ul></section>}
        {courseError && <p role="status">{courseError}</p>}
        <PageHeading title="Projects" description={account.course ? `${account.course.name} · ${account.course.term} · ${account.course.section}` : 'Continue a map or start a new one'} actions={records.length ? <Action disabled={busy} onClick={() => open(null)}>New project</Action> : null} />
        {records.length ? <div className="studio-projects" aria-label="Saved projects">{records.map(record => <ProjectRow key={record.id} title={record.title || 'Untitled systems map'} subtitle={record.localOnly ? 'Device copy' : undefined} detail={`Updated ${new Date(record.updatedAt).toLocaleString()}`} disabled={busy} onOpen={() => open(record)} openLabel="Open" />)}</div>
          : <EmptyState title="Start your first map" description="Begin with a memo" action={<Action disabled={busy} onClick={() => open(null)}>New project</Action>} />}
        {account.course && account.role === 'instructor' && <CoursePromptEditor key={account.cacheKey} course={account.course} request={request} />}
        <Disclosure title="Account" className="account-details">
          <p>Model usage {quota ? `approximately ${quota.remaining_percent}% remaining` : 'unavailable'}</p>
          <form action="/auth/logout" method="post"><Action variant="ghost" type="submit">Sign out</Action></form>
        </Disclosure>
      </> : <p role="status">{status}</p>}
      {error && <p role="alert" className="account-error">{error}</p>}
    </main>
  </AccessFrame>;
}

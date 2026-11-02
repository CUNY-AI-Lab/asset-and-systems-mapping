import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountWorkspace from './AccountWorkspace.jsx';
import { ProjectRow } from './ui/StudioPrimitives.jsx';
import { createDefaultProject, parseProject, serializeProject } from './domain.js';
import { projectStorage, releaseAccountStorage, useAccountStorage } from './accountStorage.js';
import { parseCourseSelection } from './courseContext.js';
import { loadDurableProject, saveProjectToLibrary, STORAGE_KEY } from './projectLibrary.js';
import { downloadBlob } from './mapExport.js';
import { projectProgress } from './projectProgress.js';
import { deletedProjects } from './projectRecovery.js';

vi.mock('./App.jsx', async importOriginal => {
  const original = await importOriginal();
  return {
    ...original,
    default: function WorkspaceFixture({ onAccountDashboard, onOpenAccount, onSubmitRevision }) {
      const [draft,setDraft]=React.useState('');
      return <><h1>Project workspace</h1><input aria-label="Map draft" value={draft} onChange={event=>setDraft(event.target.value)} /><button onClick={onOpenAccount}>Account</button><button onClick={onAccountDashboard}>Back to Projects</button>{onSubmitRevision && <button onClick={() => onSubmitRevision(projects[0])}>Submit test revision</button>}</>;
    },
  };
});
vi.mock('./TeacherDashboard.jsx',()=>({default:function InstructorFixture(){const [draft,setDraft]=React.useState('');return <><h2>Embedded instructor</h2><input aria-label="Instructor draft" value={draft} onChange={event=>setDraft(event.target.value)} /></>;}}));
vi.mock('./mapExport.js',async original=>({...await original(),downloadBlob:vi.fn()}));

let projects;
let fetchMock;
let workspaceAccount;
let workspaceCourses;

beforeEach(() => {
  window.localStorage.clear();
  releaseAccountStorage();
  window.history.replaceState(null, '', '/');
  workspaceAccount = { cacheKey: 'dashboard-test-account', role: 'instructor', course: null };
  workspaceCourses = [];
  document.documentElement.dataset.theme = 'light';
  projects = ['First saved map', 'Second saved map'].map((title, index) => {
    const project = createDefaultProject();
    project.id = `dashboard-project-${index}`;
    project.title = title;
    return project;
  });
  fetchMock = vi.fn(async (path, options) => {
    let payload;
    if (path === '/api/cloud/account') payload = { account: workspaceAccount };
    else if (path === '/api/cloud/projects') payload = { projects: projects.map(project => ({ id:project.id, title:project.title, updatedAt:project.updatedAt, progress:projectProgress(project) })) };
    else if (path === '/api/cloud/quota') payload = { quota: { remaining_percent: 90 } };
    else if (path === '/api/cloud/courses') payload = { courses: workspaceCourses };
    else if (path === '/api/cloud/course-prompt') payload = { prompt: { amendment: 'Course instructions', revision: 1, changeNote: 'Initial', updatedAt: null } };
    else if (path.endsWith('/submitted-revisions')) payload = { recorded: true };
    else if (path.startsWith('/api/cloud/projects/')) {
      const index = projects.findIndex(project => path.endsWith(project.id));
      const project = projects[index];
      if(options?.method==='PUT'){
        const body=JSON.parse(options.body),next=parseProject(body.project);
        if(index<0)projects.push(next);else projects[index]=next;
        payload={revision:body.revision+1};
      } else if(options?.method==='DELETE') {projects.splice(index,1);payload={deleted:true};}
      else payload={project:serializeProject(project),revision:1};
    } else throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  releaseAccountStorage();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.mocked(downloadBlob).mockClear();
});

describe('Account dashboard controls', () => {
  it('starts a new project with the verified preferred name and preserves existing titles', async () => {
    workspaceAccount.preferredName = 'Sam Student';
    render(<AccountWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    await screen.findByRole('heading', { name: 'Project workspace' });
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true));
    const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(JSON.parse(JSON.parse(options.body).project).title).toBe('Sam Student');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Projects' }));
    const row = await screen.findByRole('article', { name: 'First saved map' });
    fireEvent.click(within(row).getByRole('button', { name: 'Open project' }));
    await screen.findByRole('heading', { name: 'Project workspace' });
    expect(JSON.parse(projectStorage().getItem(STORAGE_KEY)).title).toBe('First saved map');
  });

  it('keeps the editable default title when the profile name is unavailable', async () => {
    workspaceAccount.preferredName = null;
    render(<AccountWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true));
    const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(JSON.parse(JSON.parse(options.body).project).title).toBe('Untitled systems map');
  });

  it('opens a shared map while course discovery is still pending', async () => {
    window.history.replaceState(null, '', '/p/' + 'a'.repeat(24));
    const normal = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((path, options) => {
      if (path === '/api/cloud/courses') return new Promise(() => {});
      if (path.startsWith('/api/projects/')) return Promise.resolve(new Response(JSON.stringify({ project: serializeProject(projects[0]), projectId: projects[0].id }), { headers: { 'content-type': 'application/json' } }));
      return normal(path, options);
    });
    render(<AccountWorkspace />);
    await screen.findByRole('heading', { name: 'Project workspace' });
  });

  it('uses concise visible project actions and opens the chosen map', async () => {
    render(<AccountWorkspace />);
    const row = await screen.findByRole('article', { name: 'Second saved map' });
    const open = within(row).getByRole('button', { name: 'Open project' });
    expect(open).toHaveTextContent('Second saved map');
    expect(screen.getAllByRole('button', { name: 'Open project' })).toHaveLength(2);
    fireEvent.click(open);
    await screen.findByRole('heading', { name: 'Project workspace' });
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/projects/dashboard-project-1', expect.any(Object));
  });

  it('keeps the icon theme control and embedded Account tabs functional', async () => {
    render(<AccountWorkspace />);
    await screen.findByRole('heading', { name: 'Projects' });
    const theme = screen.getByRole('button', { name: 'Switch to dark mode' });
    expect(theme).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(theme);
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(theme.textContent).toBe('');
    fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));
    expect(await screen.findByRole('heading',{name:'Account',exact:true})).toBeVisible();
    expect(screen.getByText('Approximately 90% remaining')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Instructor Console' }));
    await screen.findByRole('heading', { name: 'Embedded instructor' });
  });

  it('keeps project actions concise and accessible in the device dashboard', () => {
    const onOpen = vi.fn();
    render(<ProjectRow title="Device map" onOpen={onOpen} />);
    const open = screen.getByRole('button', { name: 'Open project' });
    expect(open).toHaveTextContent('Device map');
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps a queued account save bound to its original cache adapter', async () => {
    render(<AccountWorkspace />);
    const row = await screen.findByRole('article', { name: 'First saved map' });
    fireEvent.click(within(row).getByRole('button', { name: 'Open project' }));
    await screen.findByRole('heading', { name: 'Project workspace' });
    const originalStorage = projectStorage();
    const edited = structuredClone(projects[0]);
    edited.submission.text = 'Account-scoped recovery memo';
    originalStorage.onProjectSaved(edited);
    const otherStorage = useAccountStorage('other-account', null);
    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/cloud/projects/dashboard-project-0' && options.method === 'PUT')).toBe(true));
    const [, options] = fetchMock.mock.calls.find(([path, options]) => path === '/api/cloud/projects/dashboard-project-0' && options.method === 'PUT');
    expect(options.headers['x-systems-account-cache']).toBe('dashboard-test-account');
    await waitFor(() => expect(originalStorage.getItem('systems-mapping.cloud-sync.dashboard-project-0')).not.toBeNull());
    expect(otherStorage.getItem('systems-mapping.cloud-sync.dashboard-project-0')).toBeNull();
  });

  it('shows course guidance editing only to an instructor in that course', async () => {
    window.history.replaceState(null, '', '/?course=course-a');
    workspaceAccount = { cacheKey: 'course-a-cache', role: 'instructor', course: { id: 'course-a', name: 'Synthetic course A', term: 'Fall 2026', section: '01', promptRevision: 1 } };
    render(<AccountWorkspace />);
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.getByRole('heading',{name:'Projects'}).parentElement).toHaveTextContent('Synthetic course A · Fall 2026 · 01');
    expect(fetchMock.mock.calls.some(([path])=>path==='/api/cloud/course-prompt')).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));
    await screen.findByRole('heading',{name:'Account',exact:true});
    fireEvent.click(screen.getByRole('tab',{name:'Instructor Console'}));
    fireEvent.click(screen.getByText('Course guidance', { selector: 'summary' }));
    await screen.findByLabelText('Additional course guidance');
    for (const [, options] of fetchMock.mock.calls) expect(options.headers['x-systems-course']).toBe('course-a');
    expect(projectStorage().cacheKey).toBe('course-a-cache');
  });

  it('offers each course instructor a direct console link from the general workspace', async () => {
    workspaceAccount.role = 'student';
    workspaceCourses = [
      { id: 'course-a', name: 'Teaching course', term: 'Fall 2026', section: '01', role: 'instructor' },
      { id: 'course-b', name: 'Student course', term: 'Fall 2026', section: '02', role: 'student' },
      { id: 'course-c', name: 'Guest course', term: 'Fall 2026', section: '03', role: 'instructor', guestInstructor: true },
    ];
    render(<AccountWorkspace />);
    await screen.findByRole('heading',{name:'Projects'});
    fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));
    const courses = await screen.findByRole('region', { name: 'Classes and materials' });
    expect(within(courses).getByRole('link', { name: 'Instructor Console for Teaching course · Fall 2026 · 01' })).toHaveAttribute('href', '/?course=course-a&view=instructor');
    expect(within(courses).getByRole('link', { name: 'Instructor Console for Guest course · Fall 2026 · 03' })).toHaveAttribute('href', '/?course=course-c&view=instructor');
    expect(within(courses).getAllByRole('link', { name: /Instructor Console/ })).toHaveLength(2);
    expect(within(courses).getByRole('link', { name: 'Student course · Fall 2026 · 02' })).toHaveAttribute('href', '/?course=course-b');
    expect(screen.queryByRole('button', { name: 'Instructor Console' })).not.toBeInTheDocument();
  });

  it('opens the requested course console only after verifying its instructor role and returns to course Projects', async () => {
    window.history.replaceState(null, '', '/?course=course-a&view=instructor');
    workspaceAccount = { cacheKey: 'course-a-cache', role: 'instructor', course: { id: 'course-a', name: 'Teaching course', term: 'Fall 2026', section: '01' } };
    let resolveAccount;
    const normal = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((path, options) => path === '/api/cloud/account'
      ? new Promise(resolve => { resolveAccount = () => resolve(normal(path, options)); }) : normal(path, options));
    render(<AccountWorkspace />);
    expect(screen.queryByRole('heading', { name: 'Embedded instructor' })).not.toBeInTheDocument();
    resolveAccount();
    await screen.findByRole('heading', { name: 'Embedded instructor' });
    expect(screen.getByRole('tab',{name:'Instructor Console'})).toHaveAttribute('aria-selected','true');
    expect(projectStorage().courseSelection.id).toBe('course-a');
    fireEvent.click(screen.getByRole('button', { name: 'Projects', exact:true }));
    await screen.findByRole('heading', { name: 'Projects' });
    expect(window.location.search).toBe('?course=course-a');
    for (const [, options] of fetchMock.mock.calls) expect(options.headers['x-systems-course']).toBe('course-a');
  });

  it.each(['student', 'member'])('keeps direct console requests in Projects for a verified course %s', async role => {
    window.history.replaceState(null, '', '/?course=course-a&view=instructor');
    workspaceAccount = { cacheKey: 'course-a-cache', role, course: { id: 'course-a', name: 'Course A' } };
    render(<AccountWorkspace />);
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByRole('heading', { name: 'Teacher workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Instructor Console' })).not.toBeInTheDocument();
  });

  it.each(['student', 'member'])('does not expose instructor guidance to a course %s', async role => {
    window.history.replaceState(null, '', '/?course=course-a');
    workspaceAccount = { cacheKey: 'course-a-cache', role, course: { id: 'course-a', name: 'Synthetic course A', term: 'Fall 2026', section: '01' } };
    render(<AccountWorkspace />);
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByText('Course guidance', { selector: 'summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Instructor Console' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/cloud/course-prompt')).toBe(false);
  });

  it('does not show the course editor to a general instructor', async () => {
    render(<AccountWorkspace />);
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByText('Course guidance', { selector: 'summary' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/cloud/course-prompt')).toBe(false);
    for (const [, options] of fetchMock.mock.calls) expect(options.headers).not.toHaveProperty('x-systems-course');
  });

  it('retains course scope in queued saves and dashboard navigation after URL and adapter changes', async () => {
    window.history.replaceState(null, '', '/?course=course-a');
    workspaceAccount = { cacheKey: 'course-a-cache', role: 'student', course: { id: 'course-a', name: 'Synthetic course A', term: 'Fall 2026', section: '01' } };
    render(<AccountWorkspace />);
    const row = await screen.findByRole('article', { name: 'First saved map' });
    fireEvent.click(within(row).getByRole('button', { name: 'Open project' }));
    await screen.findByRole('heading', { name: 'Project workspace' });
    const original = projectStorage();
    const edited = structuredClone(projects[0]);
    edited.submission.text = 'Isolated course A draft';
    original.onProjectSaved(edited);
    window.history.replaceState(null, '', '/?course=course-b');
    const other = useAccountStorage('course-b-cache', null, parseCourseSelection('?course=course-b'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path.endsWith('/dashboard-project-0') && options.method === 'PUT')).toBe(true));
    const [, options] = fetchMock.mock.calls.find(([path, options]) => path.endsWith('/dashboard-project-0') && options.method === 'PUT');
    expect(options.headers['x-systems-course']).toBe('course-a');
    expect(options.headers['x-systems-account-cache']).toBe('course-a-cache');
    await waitFor(() => expect(original.getItem('systems-mapping.cloud-sync.dashboard-project-0')).not.toBeNull());
    expect(other.getItem('systems-mapping.cloud-sync.dashboard-project-0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Projects' }));
    await screen.findByRole('heading', { name: 'Projects' });
    expect(window.location.search).toBe('?course=course-a');
    expect(fetchMock.mock.calls.at(-1)[1].headers['x-systems-account-cache']).toBe('course-a-cache');
  });

  it.each([403, 503])('does not fall back to general projects after course access returns %s', async status => {
    window.history.replaceState(null, '', '/?course=course-a');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'internal_enrollment_diagnostic', details: { code: status === 403 ? 'course_access_denied' : 'course_access_unavailable' } }), { status, headers: { 'content-type': 'application/json' } }));
    render(<AccountWorkspace />);
    await screen.findByRole('alert');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('internal_enrollment_diagnostic');
    expect(projectStorage().cacheKey).toBeUndefined();
  });

  it('rejects duplicate course selections without requesting the general workspace', async () => {
    window.history.replaceState(null, '', '/?course=course-a&course=course-a');
    render(<AccountWorkspace />);
    await screen.findByRole('alert');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument();
  });

  it('rejects an account response for a different course before reading any projects', async () => {
    window.history.replaceState(null, '', '/?course=course-a');
    workspaceAccount = { cacheKey: 'course-b-cache', role: 'instructor', course: { id: 'course-b' } };
    render(<AccountWorkspace />);
    await screen.findByRole('alert');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(projectStorage().cacheKey).toBeUndefined();
  });

  it('keeps course and project destination in the signed-out login link', async () => {
    window.history.replaceState(null, '', '/p/abcdefghijklmnopqrst?course=course-a');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'content-type': 'application/json' } }));
    render(<AccountWorkspace />);
    const link = await screen.findByRole('link', { name: 'CUNY Login' });
    expect(new URL(link.href).searchParams.get('returnTo')).toBe('/p/abcdefghijklmnopqrst?course=course-a');
  });

  it('keeps the requested course console in the signed-out login link', async () => {
    window.history.replaceState(null, '', '/?course=course-a&view=instructor');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'content-type': 'application/json' } }));
    render(<AccountWorkspace />);
    const link = await screen.findByRole('link', { name: 'CUNY Login' });
    expect(new URL(link.href).searchParams.get('returnTo')).toBe('/?course=course-a&view=instructor');
  });
});

it('submits only after the course map is saved and sends the saved revision in the same workspace', async () => {
  workspaceAccount = { cacheKey:'student-course', role:'student', course:{id:'course-a',name:'Course A'} };
  window.history.replaceState(null,'','/?course=course-a');
  // Sorting puts the newer map first; open the map this test actually revises.
  projects[1].updatedAt = new Date(Date.parse(projects[0].updatedAt) + 1000).toISOString();
  render(<AccountWorkspace />);
  const map = await screen.findByRole('article', { name: 'First saved map' });
  fireEvent.click(within(map).getByRole('button', { name: 'Open project', exact: true }));
  const submit=await screen.findByRole('button',{name:'Submit test revision'});
  projects[0].submission.text='An intentional memo revision';
  fireEvent.click(submit);
  await waitFor(()=>expect(fetchMock.mock.calls.some(([path])=>path.endsWith('/submitted-revisions'))).toBe(true));
  const calls=fetchMock.mock.calls;
  const index=calls.findIndex(([path])=>path.endsWith('/submitted-revisions'));
  expect(calls.slice(0,index).some(([path,options])=>path==='/api/cloud/projects/dashboard-project-0' && options?.method==='PUT')).toBe(true);
  expect(JSON.parse(calls[index][1].body)).toEqual({revision:2});
  expect(new Headers(calls[index][1].headers).get('x-systems-course')).toBe('course-a');
});

it('preserves map and instructor drafts and the chosen Account tab across navigation',async()=>{
  workspaceAccount.preferredName='Synthetic profile';workspaceAccount.email='synthetic@example.edu';
  render(<AccountWorkspace />);
  fireEvent.click(within(await screen.findByRole('article',{name:'First saved map'})).getByRole('button',{name:'Open project'}));
  fireEvent.change(await screen.findByRole('textbox',{name:'Map draft'}),{target:{value:'Unsaved synthetic map editor'}});
  fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));
  expect(await screen.findByRole('heading',{name:'Account',exact:true})).toBeVisible();
  expect(screen.getByText('synthetic@example.edu')).toBeVisible();
  fireEvent.click(screen.getByRole('tab',{name:'Instructor Console'}));
  fireEvent.change(await screen.findByRole('textbox',{name:'Instructor draft'}),{target:{value:'Unpublished synthetic guidance'}});
  fireEvent.click(screen.getByRole('tab',{name:'Overview'}));
  fireEvent.keyDown(screen.getByRole('tab',{name:'Overview'}),{key:'ArrowRight'});
  expect(screen.getByRole('textbox',{name:'Instructor draft'})).toHaveValue('Unpublished synthetic guidance');
  fireEvent.click(screen.getByRole('button',{name:'Return to map'}));
  expect(await screen.findByRole('textbox',{name:'Map draft'})).toHaveValue('Unsaved synthetic map editor');
  fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));
  await screen.findByRole('heading',{name:'Account',exact:true});
  expect(screen.getByRole('tab',{name:'Instructor Console'})).toHaveAttribute('aria-selected','true');
  expect(screen.getByRole('textbox',{name:'Instructor draft'})).toHaveValue('Unpublished synthetic guidance');
});

it.each(['student','member'])('does not turn a remembered instructor tab into authority for a %s',async role=>{
  workspaceAccount.role=role;
  useAccountStorage(workspaceAccount.cacheKey,null).setItem('account-navigation',JSON.stringify({open:true,tab:'instructor'}));
  render(<AccountWorkspace />);
  await screen.findByRole('heading',{name:'Account',exact:true});
  expect(screen.queryByRole('tab',{name:'Instructor Console'})).not.toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'Embedded instructor'})).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([path])=>/teacher|course-prompt|course-students/.test(path))).toBe(false);
});

it('labels existing demo guest-instructor access without inventing a tester entitlement',async()=>{
  window.history.replaceState(null,'','/?course=cail-teaching-tools-demo');
  workspaceAccount={cacheKey:'synthetic-demo-guest',role:'instructor',course:{id:'cail-teaching-tools-demo',name:'Teaching demo',guestInstructor:true}};
  render(<AccountWorkspace />);
  await screen.findByRole('heading',{name:'Projects'});
  fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));
  await screen.findByRole('heading',{name:'Account',exact:true});
  expect(screen.getByText('Guest instructor',{exact:true})).toBeVisible();
  expect(screen.getByRole('tab',{name:'Instructor Console'})).toBeVisible();
  expect(screen.queryByText(/tester/i)).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([path])=>/teacher|course-prompt|course-students/.test(path))).toBe(false);
});

it('shows unavailable usage rather than fabricating a quota and keeps courses account-scoped',async()=>{
  workspaceAccount.role='student';
  const normal=fetchMock.getMockImplementation();
  fetchMock.mockImplementation((path,options)=>path==='/api/cloud/quota'?Promise.reject(Error('Synthetic outage')):normal(path,options));
  render(<AccountWorkspace />);await screen.findByRole('heading',{name:'Projects'});
  fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));
  expect(await screen.findByRole('heading',{name:'Account',exact:true})).toBeVisible();
  expect(within(screen.getByRole('region',{name:'Model usage'})).getByText('Unavailable')).toBeVisible();
  expect(within(screen.getByRole('navigation',{name:'CUNY AI Lab resources'})).getByRole('link',{name:'CUNY AI Lab',exact:true})).toHaveAttribute('href','https://ailab.gc.cuny.edu');
  expect(within(screen.getByRole('region',{name:'Classes and materials'})).getByText('No classes available.')).toBeVisible();
});

it('filters and sorts actual project names without editing them',async()=>{
  projects[0].title='Zebra project';projects[1].title='Apartment project';
  projects[1].activeScale='meso';projects[1].releasedScales=['micro','meso'];
  render(<AccountWorkspace />);await screen.findByRole('heading',{name:'Projects'});
  fireEvent.change(screen.getByRole('combobox',{name:'Project order'}),{target:{value:'name'}});
  expect(screen.getAllByRole('article').map(item=>item.getAttribute('aria-label'))).toEqual(['Apartment project','Zebra project']);
  fireEvent.change(screen.getByRole('searchbox',{name:'Find projects'}),{target:{value:'zebra'}});
  expect(screen.getAllByRole('article')).toHaveLength(1);
  fireEvent.change(screen.getByRole('searchbox',{name:'Find projects'}),{target:{value:''}});
  fireEvent.change(screen.getByRole('combobox',{name:'Project level'}),{target:{value:'meso'}});
  expect(screen.getAllByRole('article').map(item=>item.getAttribute('aria-label'))).toEqual(['Apartment project']);
  expect(projects.map(project=>project.title)).toEqual(['Zebra project','Apartment project']);
});

it('saves and privately exports Field Notes before any map generation without a model request',async()=>{
  projects[0].reflection='Earlier observation';
  render(<AccountWorkspace />);
  fireEvent.click(within(await screen.findByRole('article',{name:'First saved map'})).getByRole('button',{name:'Notes'}));
  const dialog=await screen.findByRole('dialog',{name:'First saved map'});
  const note=within(dialog).getByRole('textbox',{name:'Field Notes',exact:true});
  expect(note).toHaveValue('Earlier observation');
  expect(note).not.toHaveAttribute('placeholder');
  fireEvent.change(note,{target:{value:'A new observation before guidance or graph generation.'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Save note'}));
  expect(await within(dialog).findByRole('status')).toHaveTextContent('Saved');
  expect(projects[0].reflection).toBe('A new observation before guidance or graph generation.');
  expect(projects[0].stage).toBe(0);expect(projects[0].graph.nodes).toEqual([]);
  fireEvent.click(within(dialog).getByRole('button',{name:'Private backup'}));
  await waitFor(()=>expect(downloadBlob).toHaveBeenCalledOnce());
  const blob=vi.mocked(downloadBlob).mock.calls[0][0];
  const contents=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});
  expect(parseProject(contents).reflection).toBe(projects[0].reflection);
  expect(parseProject(contents).submission.text).toBe(projects[0].submission.text);
  expect(fetchMock.mock.calls.some(([path])=>/preflight\/evaluations|map\/connections|guidance-jobs/.test(path))).toBe(false);
});

it('requires deletion confirmation and keeps recovery available across reload and restore',async()=>{
  projects[0].reflection='Preserve these private notes';
  const original=structuredClone(projects[0]);
  const normal=fetchMock.getMockImplementation();
  fetchMock.mockImplementation((path,options)=>{
    if(options?.method==='DELETE')expect(deletedProjects(projectStorage())).toHaveLength(1);
    return normal(path,options);
  });
  render(<AccountWorkspace />);
  fireEvent.click(within(await screen.findByRole('article',{name:original.title})).getByRole('button',{name:'Delete'}));
  const dialog=await screen.findByRole('dialog',{name:original.title});
  expect(within(dialog).getByRole('button',{name:'Delete',exact:true})).toBeDisabled();
  expect(fetchMock.mock.calls.some(([,options])=>options.method==='DELETE')).toBe(false);
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button',{name:'Delete',exact:true}));
  await waitFor(()=>expect(screen.queryByRole('article',{name:original.title})).not.toBeInTheDocument());
  const [entry]=deletedProjects(projectStorage());expect(parseProject(entry.project).reflection).toBe(original.reflection);
  cleanup();render(<AccountWorkspace />);await screen.findByRole('heading',{name:'Projects'});
  fireEvent.click(screen.getByText('Project recovery (1)',{selector:'summary'}));
  fireEvent.click(screen.getByRole('button',{name:'Restore',exact:true}));
  expect(await screen.findByRole('article',{name:original.title})).toBeVisible();
  expect(projects.find(project=>project.id===original.id).reflection).toBe(original.reflection);
  expect(fetchMock.mock.calls.filter(([,options])=>options.method==='PUT').at(-1)[1].body).toContain('"revision":0');
});

it('sends no delete when a verified recovery cannot be written',async()=>{
  render(<AccountWorkspace />);
  fireEvent.click(within(await screen.findByRole('article',{name:'First saved map'})).getByRole('button',{name:'Delete'}));
  const dialog=await screen.findByRole('dialog',{name:'First saved map'});
  const original=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key.includes('.deleted-project.'))throw Error('Synthetic quota failure');return original.call(this,key,value);});
  fireEvent.click(within(dialog).getByRole('checkbox'));fireEvent.click(within(dialog).getByRole('button',{name:'Delete',exact:true}));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('This action could not be completed.');
  expect(within(dialog).getByRole('alert')).not.toHaveTextContent('Synthetic quota failure');
  expect(fetchMock.mock.calls.some(([,options])=>options.method==='DELETE')).toBe(false);
  expect(projects).toHaveLength(2);
});

it('retains the project and recovery after a stale delete refusal',async()=>{
  const normal=fetchMock.getMockImplementation();
  fetchMock.mockImplementation((path,options)=>options?.method==='DELETE'?Promise.resolve(new Response(JSON.stringify({error:'This project changed.'}),{status:409,headers:{'content-type':'application/json'}})):normal(path,options));
  render(<AccountWorkspace />);
  fireEvent.click(within(await screen.findByRole('article',{name:'First saved map'})).getByRole('button',{name:'Delete'}));
  const dialog=await screen.findByRole('dialog',{name:'First saved map'});
  fireEvent.click(within(dialog).getByRole('checkbox'));fireEvent.click(within(dialog).getByRole('button',{name:'Delete',exact:true}));
  expect(await within(dialog).findByRole('alert')).toBeVisible();
  expect(projects).toHaveLength(2);expect(deletedProjects(projectStorage())).toHaveLength(1);
});

it('rechecks current instructor access before reopening Account and removes revoked instructor UI',async()=>{
  render(<AccountWorkspace />);await screen.findByRole('heading',{name:'Projects'});
  fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));await screen.findByRole('heading',{name:'Account',exact:true});
  expect(screen.getByRole('tab',{name:'Instructor Console'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Projects',exact:true}));
  workspaceAccount={...workspaceAccount,role:'student'};
  fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));await screen.findByRole('heading',{name:'Account',exact:true});
  await waitFor(()=>expect(screen.queryByRole('tab',{name:'Instructor Console'})).not.toBeInTheDocument());
  expect(fetchMock.mock.calls.filter(([path])=>path==='/api/cloud/account')).toHaveLength(3);
});

it('does not install a different account or expose its cached projects during Account navigation',async()=>{
  render(<AccountWorkspace />);
  fireEvent.click(within(await screen.findByRole('article',{name:'First saved map'})).getByRole('button',{name:'Open project'}));
  await screen.findByRole('heading',{name:'Project workspace'});
  const originalStorage=projectStorage();
  workspaceAccount={cacheKey:'different-synthetic-account',role:'instructor',preferredName:'Different profile'};
  fireEvent.click(screen.getByRole('button',{name:'Account',exact:true}));
  await screen.findByRole('link',{name:'CUNY Login'});
  expect(screen.queryByRole('tab',{name:'Instructor Console'})).not.toBeInTheDocument();
  expect(screen.queryByText('Different profile')).not.toBeInTheDocument();
  expect(originalStorage.cacheKey).toBe('dashboard-test-account');
  expect(loadDurableProject(originalStorage,'dashboard-project-0').title).toBe('First saved map');
});

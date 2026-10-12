import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountWorkspace from './AccountWorkspace.jsx';
import { ProjectRow } from './ui/StudioPrimitives.jsx';
import { createDefaultProject, serializeProject } from './domain.js';
import { projectStorage, releaseAccountStorage, useAccountStorage } from './accountStorage.js';
import { parseCourseSelection } from './courseContext.js';

vi.mock('./App.jsx', async importOriginal => {
  const original = await importOriginal();
  return {
    ...original,
    default: ({ startInTeacher, onAccountDashboard }) => <><h1>{startInTeacher ? 'Teacher workspace' : 'Project workspace'}</h1><button onClick={onAccountDashboard}>Back to Projects</button></>,
  };
});

let projects;
let fetchMock;
let workspaceAccount;

beforeEach(() => {
  window.localStorage.clear();
  releaseAccountStorage();
  window.history.replaceState(null, '', '/');
  workspaceAccount = { cacheKey: 'dashboard-test-account', role: 'instructor', course: null };
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
    else if (path === '/api/cloud/projects') payload = { projects: projects.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) };
    else if (path === '/api/cloud/quota') payload = { quota: { remaining_percent: 90 } };
    else if (path === '/api/cloud/course-prompt') payload = { prompt: { amendment: 'Course instructions', revision: 1, changeNote: 'Initial', updatedAt: null } };
    else if (path.startsWith('/api/cloud/projects/')) {
      const project = projects.find(project => path.endsWith(project.id));
      payload = options?.method === 'PUT' ? { revision: 2 } : { project: serializeProject(project), revision: 1 };
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
});

describe('Account dashboard controls', () => {
  it('uses concise visible project actions and opens the chosen map', async () => {
    render(<AccountWorkspace />);
    const row = await screen.findByRole('article', { name: 'Second saved map' });
    const open = within(row).getByRole('button', { name: 'Open project' });
    expect(open).toHaveTextContent('Open→');
    expect(open.textContent).not.toContain('project');
    expect(screen.getAllByRole('button', { name: 'Open project' })).toHaveLength(2);
    fireEvent.click(open);
    await screen.findByRole('heading', { name: 'Project workspace' });
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/projects/dashboard-project-1', expect.any(Object));
  });

  it('keeps theme, teacher and Account disclosure controls functional', async () => {
    render(<AccountWorkspace />);
    await screen.findByRole('heading', { name: 'Projects' });
    const theme = screen.getByRole('button', { name: 'Switch to dark mode' });
    expect(theme).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(theme);
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveAttribute('aria-pressed', 'true');
    const summary = screen.getByText('Account', { selector: 'summary' });
    fireEvent.click(summary);
    await waitFor(() => expect(summary.parentElement).toHaveAttribute('open'));
    expect(screen.getByText('Model usage approximately 90% remaining')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Teacher Console' }));
    await screen.findByRole('heading', { name: 'Teacher workspace' });
  });

  it('keeps project actions concise and accessible in the device dashboard', () => {
    const onOpen = vi.fn();
    render(<ProjectRow title="Device map" onOpen={onOpen} />);
    const open = screen.getByRole('button', { name: 'Open project' });
    expect(open).toHaveTextContent('Open→');
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
    expect(screen.getByText('Synthetic course A · Fall 2026 · 01')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Course guidance', { selector: 'summary' }));
    await screen.findByLabelText('Additional course guidance');
    for (const [, options] of fetchMock.mock.calls) expect(options.headers['x-systems-course']).toBe('course-a');
    expect(projectStorage().cacheKey).toBe('course-a-cache');
  });

  it.each(['student', 'member'])('does not expose instructor guidance to a course %s', async role => {
    window.history.replaceState(null, '', '/?course=course-a');
    workspaceAccount = { cacheKey: 'course-a-cache', role, course: { id: 'course-a', name: 'Synthetic course A', term: 'Fall 2026', section: '01' } };
    render(<AccountWorkspace />);
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByText('Course guidance', { selector: 'summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Teacher Console' })).not.toBeInTheDocument();
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
});

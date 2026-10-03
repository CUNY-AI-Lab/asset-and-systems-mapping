import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountWorkspace from './AccountWorkspace.jsx';
import { ProjectRow } from './ui/StudioPrimitives.jsx';
import { createDefaultProject, serializeProject } from './domain.js';
import { projectStorage, releaseAccountStorage, useAccountStorage } from './accountStorage.js';

vi.mock('./App.jsx', async importOriginal => {
  const original = await importOriginal();
  return {
    ...original,
    default: ({ startInTeacher }) => <h1>{startInTeacher ? 'Teacher workspace' : 'Project workspace'}</h1>,
  };
});

let projects;
let fetchMock;

beforeEach(() => {
  window.localStorage.clear();
  releaseAccountStorage();
  document.documentElement.dataset.theme = 'light';
  projects = ['First saved map', 'Second saved map'].map((title, index) => {
    const project = createDefaultProject();
    project.id = `dashboard-project-${index}`;
    project.title = title;
    return project;
  });
  fetchMock = vi.fn(async (path, options) => {
    let payload;
    if (path === '/api/cloud/account') payload = { account: { cacheKey: 'dashboard-test-account', role: 'instructor' } };
    else if (path === '/api/cloud/projects') payload = { projects: projects.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) };
    else if (path === '/api/cloud/quota') payload = { quota: { remaining_percent: 90 } };
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
});

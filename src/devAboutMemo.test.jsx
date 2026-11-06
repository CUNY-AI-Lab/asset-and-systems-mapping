// @vitest-environment-options {"url":"https://systems-mapping-dev.ailab-452.workers.dev/"}
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoFileUpload, createBlankProject } from './App.jsx';
import { CUNY_ABOUT_MEMO, CUNY_ABOUT_URL } from './devAboutMemo.js';
import { activeSubmission } from './projectMemo.js';
import { stableId, validateProject } from './domain.js';
import { openMemoWorkflowScale } from './memoWorkflow.js';

const label = 'Load CUNY AI Lab About';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(project = createBlankProject()) {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  let next;
  const update = vi.fn(change => { next = structuredClone(project); change(next); validateProject(next); });
  render(<MemoFileUpload project={project} update={update} />);
  return { update, fetch, loaded: () => next };
}
it('loads the public About text into the current Dev draft without requesting a model', () => {
  const project = createBlankProject(); project.submission.text = '';
  const { loaded, fetch, update } = mount(project);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(update).toHaveBeenCalledTimes(1);
  expect(loaded().submission.text).toBe(CUNY_ABOUT_MEMO);
  expect(loaded().submission.location).toBe(CUNY_ABOUT_URL);
  expect(loaded().submission.fingerprint).toBe(stableId('src', CUNY_ABOUT_MEMO));
  expect(loaded().graph).toEqual(project.graph);
  expect(fetch).not.toHaveBeenCalled();
});
it('loads Part 2 independently while retaining Part 1 and existing graph', () => {
  const project = createBlankProject(); project.submission.text = 'Students meet in the library.';
  project.submission.fingerprint = stableId('src', project.submission.text);
  openMemoWorkflowScale(project, 'exosphere');
  const { loaded, fetch } = mount(project);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(activeSubmission(loaded()).text).toBe(CUNY_ABOUT_MEMO);
  expect(loaded().submission).toEqual(project.submission);
  expect(fetch).not.toHaveBeenCalled();
});
it.each([false, true])('confirms replacement of a nonempty draft: %s', accepted => {
  const project = createBlankProject(); project.submission.text = 'My current memo.';
  project.submission.fileName = 'current.txt'; project.submission.fileSize = 16;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(accepted);
  const { update, loaded, fetch } = mount(project);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(confirm).toHaveBeenCalledWith('Replace this memo draft with CUNY AI Lab About?');
  expect(update).toHaveBeenCalledTimes(accepted ? 1 : 0);
  if (accepted) { expect(loaded().submission.fileName).toBeUndefined(); expect(loaded().submission.fileSize).toBeUndefined(); }
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['systems-mapping.ailab-452.workers.dev', 'example.test', 'systems-mapping-dev.ailab-452.workers.dev.evil.test'])('hides the Dev preload on %s', hostname => {
  vi.stubGlobal('location', { hostname });
  mount();
  expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
});
it.each(['localhost', '127.0.0.1'])('allows the preload in the local development host %s', hostname => {
  vi.stubGlobal('location', { hostname }); mount();
  expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
});

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TeacherDashboard from './TeacherDashboard.jsx';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const teacherAccess = { mode: 'manual', claimEnabled: true };
const teacher = { id: 'local-teacher-id', displayName: 'Server Returned Teacher' };

const baseModule = {
  id: 'preflight.global.purpose',
  configKind: 'preflight',
  scale: 'global',
  moduleKey: 'purpose',
  label: 'Purpose',
  description: 'What the configuration is responsible for doing.',
  content: 'Assess whether a memo is ready for candidate graph extraction.',
  revision: 1,
  fingerprint: 'fingerprint-one',
  updatedAt: '2026-08-08T12:00:00.000Z',
  updatedByName: null,
};

const builderModule = {
  ...baseModule,
  id: 'builder.global.purpose',
  configKind: 'builder',
  content: 'Propose source-grounded graph candidates for student confirmation.',
};

const submissionSummary = {
  id: 'submission-01',
  projectId: 'project-01',
  projectMetadata: { id: 'project-01', title: 'Access pathways memo' },
  activeScale: 'meso',
  inquiry: 'How does guidance shape access to advanced courses?',
  status: 'pending',
  decision: null,
  revision: 2,
  submittedAt: '2026-08-08T13:00:00.000Z',
  updatedAt: '2026-08-08T13:00:00.000Z',
};

const suggestion = {
  hardPass: true,
  score: 6,
  threshold: 6,
  outcome: 'conditional',
  evaluatedAt: '2026-08-08T12:58:00.000Z',
  hard: [{
    id: 'H1',
    status: 'met',
    evidence: 'Staff described organized students as already planning ahead.',
    rationale: 'The memo states an observable definition.',
    nextAction: '',
    hardBlock: false,
  }],
  scored: [{
    id: 'C1',
    status: 'open',
    evidence: 'Prior access to college-prep resources is named but not traced.',
    rationale: 'The suggestion connects preparation to prior access.',
    missingVariable: 'How students outside this definition were advised.',
    nextAction: 'Add evidence about advising options.',
    hardBlock: false,
  }],
};

const submissionDetail = {
  ...submissionSummary,
  sourceMaterial: { text: 'Staff described organized students as already planning ahead. Prior access shaped who knew which courses to request.' },
  studentAnnotation: 'I want feedback on whether my evidence supports this connection.',
  suggestion,
  configSnapshot: { fingerprint: 'cfg-one', revision: 1 },
  reviewedAt: null,
  instructorAnnotation: null,
  revisedSuggestion: null,
  reviewingTeacher: null,
};

function authenticatedFetch({ queue, detail = submissionDetail, decision, modules = [baseModule, builderModule], history = [] } = {}) {
  let queueCalls = 0;
  const fetchMock = vi.fn(async (path, options = {}) => {
    if (path === '/api/auth/accounts') return jsonResponse({ teacherAccess });
    if (path === '/api/auth/me') return jsonResponse({ user: teacher });
    if (path === '/api/teacher/preflight-submissions?status=pending') {
      queueCalls += 1;
      const submissions = typeof queue === 'function' ? queue(queueCalls) : queue ?? [submissionSummary];
      return jsonResponse({ submissions });
    }
    if (path === `/api/teacher/preflight-submissions/${submissionSummary.id}`) return jsonResponse({ submission: detail, reviewEvents: [] });
    if (path === `/api/teacher/preflight-submissions/${submissionSummary.id}/decision`) {
      if (!decision) throw new Error('Unexpected decision request');
      return decision(path, options);
    }
    if (path === '/api/teacher/modules') return jsonResponse({ modules });
    if (path === '/api/teacher/history?limit=60') return jsonResponse({ history });
    throw new Error(`Unexpected fetch: ${path}`);
  });
  fetchMock.queueCallCount = () => queueCalls;
  return fetchMock;
}

async function renderAuthenticated(fetchMock = authenticatedFetch()) {
  vi.stubGlobal('fetch', fetchMock);
  render(<TeacherDashboard onConfigurationChanged={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Teacher dashboard' })).toBeVisible();
  return fetchMock;
}

async function waitForSubmission() {
  expect(await screen.findByText(submissionDetail.sourceMaterial.text)).toBeVisible();
  return screen.getByRole('group', { name: 'Submission decision' });
}

describe('TeacherDashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('defaults to the pending review queue and renders one restrained submission detail with exactly three decisions', async () => {
    const fetchMock = await renderAuthenticated();
    const reviewTab = screen.getByRole('tab', { name: 'Review submissions' });
    const guidanceTab = screen.getByRole('tab', { name: 'Model guidance' });
    expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    expect(reviewTab).toHaveAttribute('tabindex', '0');
    expect(guidanceTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();
    expect(await screen.findByRole('button', { name: /Access pathways memo/ })).toHaveAttribute('aria-current', 'true');

    const decisionGroup = await waitForSubmission();
    expect(within(decisionGroup).getAllByRole('button')).toHaveLength(3);
    expect(within(decisionGroup).getByRole('button', { name: 'Approve' })).toBeVisible();
    expect(within(decisionGroup).getByRole('button', { name: 'Revise and approve' })).toBeVisible();
    expect(within(decisionGroup).getByRole('button', { name: 'Reject' })).toBeVisible();
    expect(screen.getByText(submissionDetail.inquiry)).toBeVisible();
    expect(screen.getByText(submissionDetail.studentAnnotation)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'What the memo establishes' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'What the model suggests' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'What remains uncertain' })).toBeVisible();
    expect(screen.getAllByText('Prior access to college-prep resources is named but not traced.')).toHaveLength(2);
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/modules');
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/history?limit=60');
  });

  it('keeps manual sign-in private and loads only the queue after authentication', async () => {
    let loginBody = null;
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/auth/accounts') return jsonResponse({ teacherAccess });
      if (path === '/api/auth/me') return jsonResponse({ user: null });
      if (path === '/api/auth/login') {
        loginBody = JSON.parse(options.body);
        return jsonResponse({ user: teacher });
      }
      if (path === '/api/teacher/preflight-submissions?status=pending') return jsonResponse({ submissions: [] });
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TeacherDashboard onConfigurationChanged={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Sign in to teacher configuration.' })).toBeVisible();
    expect(screen.queryByText('Maria Mavrides Calderon')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Teacher account ID'), { target: { value: '  local-teacher-id  ' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a locally chosen phrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Teacher dashboard' })).toBeVisible();
    expect(loginBody).toEqual({ userId: 'local-teacher-id', passphrase: 'a locally chosen phrase' });
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain('/api/teacher/preflight-submissions?status=pending');
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/modules');
  });

  it('keeps manual claiming explicit and sends the bootstrap token only in the claim request', async () => {
    let claimBody = null;
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/auth/accounts') return jsonResponse({ teacherAccess });
      if (path === '/api/auth/me') return jsonResponse({ user: null });
      if (path === '/api/auth/claim') {
        claimBody = JSON.parse(options.body);
        return jsonResponse({ user: teacher }, 201);
      }
      if (path === '/api/teacher/preflight-submissions?status=pending') return jsonResponse({ submissions: [] });
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TeacherDashboard onConfigurationChanged={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Sign in to teacher configuration.' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Claim account' }));
    fireEvent.change(screen.getByLabelText('Teacher account ID'), { target: { value: 'local-teacher-id' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'another local phrase' } });
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: 'another local phrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the one-time server bootstrap token.');
    expect(claimBody).toBeNull();

    fireEvent.change(screen.getByLabelText('Server bootstrap token'), { target: { value: 'operator-only-bootstrap-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim account' }));
    expect(await screen.findByRole('heading', { name: 'Teacher dashboard' })).toBeVisible();
    expect(claimBody).toEqual({ userId: 'local-teacher-id', passphrase: 'another local phrase', bootstrapToken: 'operator-only-bootstrap-token' });
  });

  it('requires an instructor annotation before any decision is recorded', async () => {
    const fetchMock = await renderAuthenticated();
    const decisionGroup = await waitForSubmission();
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add an instructor annotation before recording a decision.');
    expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/decision'))).toBe(false);
  });

  it('discloses one revised-suggestion field only for revise and approve', async () => {
    await renderAuthenticated();
    const decisionGroup = await waitForSubmission();
    expect(screen.queryByLabelText('Revised suggestion')).not.toBeInTheDocument();
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Revise and approve' }));
    expect(screen.getByLabelText('Revised suggestion')).toBeVisible();
    expect(screen.getAllByLabelText('Revised suggestion')).toHaveLength(1);
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Reject' }));
    expect(screen.queryByLabelText('Revised suggestion')).not.toBeInTheDocument();
  });

  it('records a decision, removes the submission after queue refresh, and shows returned append-only history', async () => {
    const event = {
      id: 'review-event-01',
      decision: 'approve',
      fromRevision: 2,
      toRevision: 3,
      instructorAnnotation: 'The evidence is sufficient for candidate review.',
      revisedSuggestion: null,
      decidedAt: '2026-08-08T14:00:00.000Z',
      reviewingTeacher: teacher,
    };
    let decisionBody = null;
    const fetchMock = authenticatedFetch({
      queue: (call) => call === 1 ? [submissionSummary] : [],
      decision: async (_path, options) => {
        decisionBody = JSON.parse(options.body);
        return jsonResponse({ submission: { ...submissionDetail, status: 'approved', decision: 'approve', revision: 3, instructorAnnotation: event.instructorAnnotation }, reviewEvents: [event] });
      },
    });
    await renderAuthenticated(fetchMock);
    const decisionGroup = await waitForSubmission();
    fireEvent.change(screen.getByLabelText('Instructor annotation'), { target: { value: `  ${event.instructorAnnotation}  ` } });
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText('No submissions are waiting for review.')).toBeVisible();
    expect(screen.getByText('Decision recorded. The pending queue has been refreshed.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Latest recorded decision' })).toBeVisible();
    expect(screen.getByText(event.instructorAnnotation)).toBeVisible();
    expect(decisionBody).toEqual({ decision: 'approve', instructorAnnotation: event.instructorAnnotation, expectedRevision: 2 });
    expect(fetchMock.queueCallCount()).toBe(2);
  });

  it('preserves a revise draft on 409 and explicitly reloads the current revision before retrying', async () => {
    const postBodies = [];
    let postCount = 0;
    const current = { ...submissionDetail, revision: 3, updatedAt: '2026-08-08T14:05:00.000Z' };
    const fetchMock = authenticatedFetch({
      queue: (call) => call === 1 ? [submissionSummary] : [],
      decision: async (_path, options) => {
        postCount += 1;
        postBodies.push(JSON.parse(options.body));
        if (postCount === 1) return jsonResponse({ error: 'Submission changed.', details: { current } }, 409);
        return jsonResponse({ submission: { ...current, status: 'approved', decision: 'revise_and_approve', revision: 4 }, reviewEvents: [] });
      },
    });
    await renderAuthenticated(fetchMock);
    const decisionGroup = await waitForSubmission();
    fireEvent.change(screen.getByLabelText('Instructor annotation'), { target: { value: 'Keep the distinction between source and interpretation.' } });
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Revise and approve' }));
    fireEvent.change(screen.getByLabelText('Revised suggestion'), { target: { value: 'Connect this claim to the advising examples in the memo.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText('This submission changed in another session. Your decision draft remains available.')).toBeVisible();
    expect(screen.getByLabelText('Instructor annotation')).toHaveValue('Keep the distinction between source and interpretation.');
    expect(screen.getByLabelText('Revised suggestion')).toHaveValue('Connect this claim to the advising examples in the memo.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload current submission' }));
    expect(screen.getByText('Loaded submission revision 3. Your decision draft remains available.')).toBeVisible();
    expect(screen.getByLabelText('Instructor annotation')).toHaveValue('Keep the distinction between source and interpretation.');
    expect(screen.getByLabelText('Revised suggestion')).toHaveValue('Connect this claim to the advising examples in the memo.');

    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(postBodies).toHaveLength(2));
    expect(postBodies[0]).toEqual({
      decision: 'revise_and_approve',
      instructorAnnotation: 'Keep the distinction between source and interpretation.',
      revisedSuggestion: 'Connect this claim to the advising examples in the memo.',
      expectedRevision: 2,
    });
    expect(postBodies[1]).toMatchObject({ expectedRevision: 3, decision: 'revise_and_approve' });
  });

  it('lazy-loads model guidance on first selection, keeps one module editor visible, and roves section tabs', async () => {
    const history = [{
      id: 'history-01',
      moduleId: baseModule.id,
      label: baseModule.label,
      revision: 1,
      changeNote: 'Source-grounded starting configuration',
      changedAt: '2026-08-08T12:00:00.000Z',
      changedByName: 'Configured teacher',
    }];
    const fetchMock = await renderAuthenticated(authenticatedFetch({ history }));
    await waitForSubmission();
    const reviewTab = screen.getByRole('tab', { name: 'Review submissions' });
    const guidanceTab = screen.getByRole('tab', { name: 'Model guidance' });
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/modules');

    reviewTab.focus();
    fireEvent.keyDown(reviewTab, { key: 'ArrowRight' });
    expect(guidanceTab).toHaveFocus();
    expect(guidanceTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Prompt modules' })).toBeVisible();
    expect(screen.getAllByRole('textbox', { name: 'Module instructions' })).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Module' })).toHaveValue(baseModule.id);
    expect(screen.getByText('Shared revision history · 1').parentElement).not.toHaveAttribute('open');
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/teacher/modules')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/teacher/history?limit=60')).toHaveLength(1);

    fireEvent.keyDown(guidanceTab, { key: 'Home' });
    expect(reviewTab).toHaveFocus();
    expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(guidanceTab);
    expect(await screen.findByRole('heading', { name: 'Prompt modules' })).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/teacher/modules')).toHaveLength(1);
  });

  it('preserves modular prompt revision conflict behavior inside Model guidance', async () => {
    const putBodies = [];
    let putCount = 0;
    const fetchMock = authenticatedFetch();
    const baseImplementation = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (path, options = {}) => {
      if (String(path).startsWith('/api/teacher/modules/')) {
        putCount += 1;
        const body = JSON.parse(options.body);
        putBodies.push(body);
        if (putCount === 1) return jsonResponse({ module: { ...baseModule, content: body.content, revision: 2, fingerprint: 'fingerprint-two', updatedAt: '2026-08-08T13:00:00.000Z' } });
        return jsonResponse({ error: 'This module changed after it was loaded.', details: { current: { ...baseModule, content: 'Server revision written in another session.', revision: 3, fingerprint: 'fingerprint-three' } } }, 409);
      }
      return baseImplementation(path, options);
    });
    const onConfigurationChanged = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TeacherDashboard onConfigurationChanged={onConfigurationChanged} />);
    expect(await screen.findByRole('heading', { name: 'Teacher dashboard' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Model guidance' }));
    const editor = await screen.findByRole('textbox', { name: 'Module instructions' });
    const changeNote = screen.getByRole('textbox', { name: 'Change note' });
    fireEvent.change(editor, { target: { value: 'Edited source-grounded readiness instructions.' } });
    fireEvent.change(changeNote, { target: { value: 'Clarify readiness purpose' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    expect(await screen.findByText('Revision 2 saved.')).toBeVisible();
    expect(onConfigurationChanged).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: 'My preserved local prompt draft.' } });
    fireEvent.change(changeNote, { target: { value: 'Second change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    expect(await screen.findByText('Revision 3 is now on the server. Your unsaved draft remains in the editor.')).toBeVisible();
    expect(editor).toHaveValue('My preserved local prompt draft.');
    expect(putBodies[1]).toMatchObject({ expectedRevision: 2, changeNote: 'Second change' });
    fireEvent.click(screen.getByRole('button', { name: 'Load server revision 3' }));
    expect(editor).toHaveValue('Server revision written in another session.');
  });
});

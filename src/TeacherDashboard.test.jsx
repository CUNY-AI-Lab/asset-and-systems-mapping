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

const profileValue = {
  schemaVersion: 'cuny.course-progression.v1',
  stages: {
    'choose-scale': { guidance: 'Ask the student to choose one scale.', materials: '' },
    'add-source': { guidance: 'Return to locatable source passages.', materials: 'Course source guide excerpt.' },
    'review-suggestions': { guidance: 'Ask one focused question without completing the analysis.', materials: 'Course reading on relationships.' },
    'check-instructor-response': { guidance: 'Use the instructor response as the next direction.', materials: '' },
    'choose-what-to-map': { guidance: 'Ask the student to choose grounded actors and relationships.', materials: '' },
    'build-map': { guidance: 'Ask what each relationship does.', materials: '' },
    'revise-and-export': { guidance: 'Ask what changed and what the student will share.', materials: '' },
  },
};

const activeProfile = {
  id: 'systems-mapping-default',
  name: 'Course profile',
  status: 'active',
  revision: 1,
  profile: profileValue,
  fingerprint: 'a'.repeat(64),
  parentId: null,
  createdAt: '2026-08-08T12:00:00.000Z',
  createdByName: null,
  updatedAt: '2026-08-08T12:00:00.000Z',
  updatedByName: null,
  publishedAt: '2026-08-08T12:00:00.000Z',
  publishedByName: null,
};

const resource = {
  runtimes: [{ id: 'deterministic', label: 'STEM Splitter rules', teacherModulesAffectOutput: false, disclosure: 'Teacher edits are recorded with the run but do not change deterministic scoring.' }],
};

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
  focusedQuestion: null,
  reviewingTeacher: null,
};

function authenticatedFetch({ queue, detail = submissionDetail, decision, profiles = [activeProfile] } = {}) {
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
    if (path === '/api/teacher/profiles') return jsonResponse({ resource, runtime: { provider: 'deterministic', model: 'STEM Splitter' }, activeProfileId: activeProfile.id, profiles: profiles.map(({ profile: _profile, ...summary }) => summary) });
    const selectedProfile = profiles.find(({ id }) => path === `/api/teacher/profiles/${id}`);
    if (selectedProfile) return jsonResponse({ profile: selectedProfile, events: [] });
    throw new Error(`Unexpected fetch: ${path}`);
  });
  fetchMock.queueCallCount = () => queueCalls;
  return fetchMock;
}

async function renderAuthenticated(fetchMock = authenticatedFetch()) {
  vi.stubGlobal('fetch', fetchMock);
  render(<TeacherDashboard onConfigurationChanged={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Teacher Console' })).toBeVisible();
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
    const guidanceTab = screen.getByRole('tab', { name: 'Course settings' });
    expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    expect(reviewTab).toHaveAttribute('tabindex', '0');
    expect(guidanceTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();
    expect(await screen.findByRole('button', { name: /Access pathways memo/ })).toHaveAttribute('aria-current', 'true');

    const decisionGroup = await waitForSubmission();
    expect(within(decisionGroup).getAllByRole('button')).toHaveLength(3);
    expect(within(decisionGroup).getByRole('button', { name: 'Approve' })).toBeVisible();
    expect(within(decisionGroup).getByRole('button', { name: 'Approve with a question' })).toBeVisible();
    expect(within(decisionGroup).getByRole('button', { name: 'Reject' })).toBeVisible();
    expect(screen.getByText(submissionDetail.inquiry)).toBeVisible();
    expect(screen.getByText(submissionDetail.studentAnnotation)).toBeVisible();
    const modelReview = screen.getByText('Model review details').closest('details');
    expect(modelReview).not.toHaveAttribute('open');
    expect(screen.getByText('Use these details as reference. You decide what the student should revisit.')).not.toBeVisible();
    fireEvent.click(screen.getByText('Model review details'));
    expect(modelReview).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Evidence excerpts' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Possible redirects' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Open questions' })).toBeVisible();
    expect(screen.getAllByText('Prior access to college-prep resources is named but not traced.')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Write to the student.' })).toBeVisible();
    expect(screen.getByLabelText('Focus for the student')).toBeVisible();
    expect(screen.getByText(/Name one focus/)).toBeVisible();
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/modules');
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/history?limit=60');
  });

  it('distinguishes the scored-criteria total and threshold when a hard gate holds review', async () => {
    const holdSuggestion = {
      ...suggestion,
      hardPass: false,
      score: 7,
      threshold: 6,
      outcome: 'hold',
      hard: Array.from({ length: 4 }, (_, index) => ({
        id: `H${index + 1}`,
        status: index === 3 ? 'unmet' : 'met',
        evidence: index === 3 ? '' : `Hard-gate evidence ${index + 1}`,
        rationale: index === 3 ? 'The memo names only one actor-to-actor relationship.' : 'The gate is supported.',
        nextAction: index === 3 ? 'Add a second actor-to-actor relationship.' : '',
        hardBlock: true,
      })),
      scored: Array.from({ length: 8 }, (_, index) => ({
        id: `C${index + 1}`,
        status: index === 7 ? 'unmet' : 'met',
        evidence: index === 7 ? '' : `Scored evidence ${index + 1}`,
        rationale: index === 7 ? 'Uncertainty is not yet marked.' : 'The criterion is supported.',
        nextAction: index === 7 ? 'Mark what remains uncertain.' : '',
        hardBlock: false,
      })),
    };

    await renderAuthenticated(authenticatedFetch({
      detail: { ...submissionDetail, suggestion: holdSuggestion },
    }));
    await waitForSubmission();

    fireEvent.click(screen.getByText('Model review details'));
    const summary = screen.getByText('hold').closest('.suggestion-review__summary');
    expect(summary).toHaveTextContent(/hold · 7 of 8 scored criteria met · threshold 6 · one or more hard gates unmet/i);
    expect(screen.queryByText(/7\/6 readiness checks/i)).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Teacher Console' })).toBeVisible();
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
    expect(await screen.findByRole('heading', { name: 'Teacher Console' })).toBeVisible();
    expect(claimBody).toEqual({ userId: 'local-teacher-id', passphrase: 'another local phrase', bootstrapToken: 'operator-only-bootstrap-token' });
  });

  it('requires a focus for the student before any decision is recorded', async () => {
    const fetchMock = await renderAuthenticated();
    const decisionGroup = await waitForSubmission();
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a focus for the student before recording a decision.');
    expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/decision'))).toBe(false);
  });

  it('discloses one focused-question field only for approve with a question', async () => {
    await renderAuthenticated();
    const decisionGroup = await waitForSubmission();
    expect(screen.queryByLabelText('Question for the student')).not.toBeInTheDocument();
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Approve with a question' }));
    expect(screen.getByLabelText('Question for the student')).toBeVisible();
    expect(screen.getAllByLabelText('Question for the student')).toHaveLength(1);
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Reject' }));
    expect(screen.queryByLabelText('Question for the student')).not.toBeInTheDocument();
  });

  it('records a decision, removes the submission after queue refresh, and shows returned append-only history', async () => {
    const event = {
      id: 'review-event-01',
      decision: 'approve',
      fromRevision: 2,
      toRevision: 3,
      instructorAnnotation: 'The evidence is sufficient for candidate review.',
      focusedQuestion: null,
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
    fireEvent.change(screen.getByLabelText('Focus for the student'), { target: { value: `  ${event.instructorAnnotation}  ` } });
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
    fireEvent.change(screen.getByLabelText('Focus for the student'), { target: { value: 'Keep the distinction between source and interpretation.' } });
    fireEvent.click(within(decisionGroup).getByRole('button', { name: 'Approve with a question' }));
    fireEvent.change(screen.getByLabelText('Question for the student'), { target: { value: 'Which advising example best supports this connection?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText('This submission changed in another session. Your decision draft remains available.')).toBeVisible();
    expect(screen.getByLabelText('Focus for the student')).toHaveValue('Keep the distinction between source and interpretation.');
    expect(screen.getByLabelText('Question for the student')).toHaveValue('Which advising example best supports this connection?');
    fireEvent.click(screen.getByRole('button', { name: 'Reload current submission' }));
    expect(screen.getByText('Loaded submission revision 3. Your decision draft remains available.')).toBeVisible();
    expect(screen.getByLabelText('Focus for the student')).toHaveValue('Keep the distinction between source and interpretation.');
    expect(screen.getByLabelText('Question for the student')).toHaveValue('Which advising example best supports this connection?');

    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(postBodies).toHaveLength(2));
    expect(postBodies[0]).toEqual({
      decision: 'revise_and_approve',
      instructorAnnotation: 'Keep the distinction between source and interpretation.',
      focusedQuestion: 'Which advising example best supports this connection?',
      expectedRevision: 2,
    });
    expect(postBodies[1]).toMatchObject({ expectedRevision: 3, decision: 'revise_and_approve' });
  });

  it('lazy-loads the seven-stage course progression and roves section tabs', async () => {
    const fetchMock = await renderAuthenticated();
    await waitForSubmission();
    const reviewTab = screen.getByRole('tab', { name: 'Review submissions' });
    const guidanceTab = screen.getByRole('tab', { name: 'Course settings' });
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/profiles');

    reviewTab.focus();
    fireEvent.keyDown(reviewTab, { key: 'ArrowRight' });
    expect(guidanceTab).toHaveFocus();
    expect(guidanceTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Course settings' })).toBeVisible();
    expect(await screen.findByLabelText('How should the model guide this stage?')).toHaveValue(profileValue.stages['choose-scale'].guidance);
    expect(screen.getByLabelText('What course material should the model draw on?')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Stage 3.*Review suggestions/ }));
    expect(screen.getByLabelText('How should the model guide this stage?')).toHaveValue(profileValue.stages['review-suggestions'].guidance);
    expect(screen.getByLabelText('What course material should the model draw on?')).toHaveValue(profileValue.stages['review-suggestions'].materials);
    expect(screen.getByText('The model receives the current stage and the stages already completed. Later stages stay out of the prompt.')).toBeVisible();
    expect(screen.queryByLabelText('Module')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/teacher/profiles')).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/modules');

    fireEvent.keyDown(guidanceTab, { key: 'Home' });
    expect(reviewTab).toHaveFocus();
    expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(guidanceTab);
    expect(await screen.findByRole('heading', { name: 'Course settings' })).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/teacher/profiles')).toHaveLength(1);
  });

  it('creates, saves, and publishes stage guidance without editing the published version in place', async () => {
    const draftProfile = { ...activeProfile, id: 'draft-profile-identifier-000001', name: 'Evidence guidance', status: 'draft', parentId: activeProfile.id };
    let profiles = [activeProfile];
    const requests = [];
    const fetchMock = vi.fn(async (path, options = {}) => {
      requests.push([path, options.method || 'GET', options.body ? JSON.parse(options.body) : null]);
      if (path === '/api/auth/accounts') return jsonResponse({ teacherAccess });
      if (path === '/api/auth/me') return jsonResponse({ user: teacher });
      if (path === '/api/teacher/preflight-submissions?status=pending') return jsonResponse({ submissions: [] });
      if (path === '/api/teacher/profiles' && options.method === 'POST') {
        profiles = [...profiles, draftProfile];
        return jsonResponse({ profile: draftProfile, events: [] }, 201);
      }
      if (path === '/api/teacher/profiles') return jsonResponse({ resource, runtime: { provider: 'deterministic', model: 'STEM Splitter' }, activeProfileId: profiles.find(({ status }) => status === 'active')?.id, profiles: profiles.map(({ profile: _profile, ...summary }) => summary) });
      if (path === `/api/teacher/profiles/${draftProfile.id}` && options.method === 'PUT') {
        const body = JSON.parse(options.body);
        const saved = { ...draftProfile, name: body.name, profile: body.profile, revision: 2, fingerprint: 'b'.repeat(64) };
        profiles = profiles.map((profile) => profile.id === saved.id ? saved : profile);
        return jsonResponse({ profile: saved, events: [{ id: 1, action: 'updated', revision: 2, note: body.note, occurredAt: '2026-08-08T13:00:00.000Z', actorName: teacher.displayName }] });
      }
      if (path === `/api/teacher/profiles/${draftProfile.id}/publish`) {
        const current = profiles.find(({ id }) => id === draftProfile.id);
        const published = { ...current, status: 'active', publishedAt: '2026-08-08T14:00:00.000Z' };
        profiles = profiles.map((profile) => profile.id === activeProfile.id ? { ...profile, status: 'retired' } : profile.id === published.id ? published : profile);
        return jsonResponse({ profile: published, events: [{ id: 2, action: 'published', revision: 2, note: JSON.parse(options.body).note, occurredAt: '2026-08-08T14:00:00.000Z', actorName: teacher.displayName }] });
      }
      const selected = profiles.find(({ id }) => path === `/api/teacher/profiles/${id}`);
      if (selected) return jsonResponse({ profile: selected, events: [] });
      throw new Error(`Unexpected fetch: ${path}`);
    });
    const onConfigurationChanged = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TeacherDashboard onConfigurationChanged={onConfigurationChanged} />);
    expect(await screen.findByRole('heading', { name: 'Teacher Console' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Course settings' }));
    expect(await screen.findByRole('heading', { name: 'Course settings' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create a draft' }));
    fireEvent.change(screen.getByLabelText('Draft name'), { target: { value: 'Evidence guidance' } });
    fireEvent.change(screen.getByLabelText('What do you plan to change?'), { target: { value: 'Focus prompts on relationships' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Evidence guidance'));
    fireEvent.click(screen.getByRole('button', { name: /Stage 3.*Review suggestions/ }));
    fireEvent.change(screen.getByLabelText('How should the model guide this stage?'), { target: { value: 'Return first to evidence that names a relationship.' } });
    fireEvent.change(screen.getByLabelText('What course material should the model draw on?'), { target: { value: 'Use the class reading on actor and relationship mapping.' } });
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview saved prompt' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: 'Focus the evidence prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft revision 2 saved.')).toBeVisible();
    expect(onConfigurationChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: 'Publish the evidence guidance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish draft' }));
    expect(await screen.findByText('Draft published. New model requests now follow these stage settings.')).toBeVisible();
    expect(onConfigurationChanged).toHaveBeenCalledTimes(1);
    expect(requests.some(([path, method]) => path === '/api/teacher/modules' && method === 'PUT')).toBe(false);
  });

  it('preserves unsaved stage guidance when the server reports a newer revision', async () => {
    const draftProfile = { ...activeProfile, id: 'draft-profile-identifier-000002', name: 'Question guidance', status: 'draft', parentId: activeProfile.id };
    const currentProfile = {
      ...draftProfile,
      revision: 2,
      profile: {
        ...profileValue,
        stages: {
          ...profileValue.stages,
          'review-suggestions': {
            ...profileValue.stages['review-suggestions'],
            guidance: 'Ask the student to name the missing relation.',
          },
        },
      },
      fingerprint: 'c'.repeat(64),
    };
    const profiles = [activeProfile, draftProfile];
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/auth/accounts') return jsonResponse({ teacherAccess });
      if (path === '/api/auth/me') return jsonResponse({ user: teacher });
      if (path === '/api/teacher/preflight-submissions?status=pending') return jsonResponse({ submissions: [] });
      if (path === '/api/teacher/profiles') return jsonResponse({ resource, runtime: { provider: 'deterministic', model: 'STEM Splitter' }, activeProfileId: activeProfile.id, profiles: profiles.map(({ profile: _profile, ...summary }) => summary) });
      if (path === `/api/teacher/profiles/${draftProfile.id}` && options.method === 'PUT') {
        return jsonResponse({ error: 'This draft changed after it was loaded.', details: { current: currentProfile } }, 409);
      }
      const selected = profiles.find(({ id }) => path === `/api/teacher/profiles/${id}`);
      if (selected) return jsonResponse({ profile: selected, events: [] });
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TeacherDashboard onConfigurationChanged={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Teacher Console' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Course settings' }));
    await screen.findByRole('heading', { name: 'Course settings' });
    fireEvent.change(screen.getByLabelText('Version', { exact: true }), { target: { value: draftProfile.id } });
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Question guidance'));
    fireEvent.click(screen.getByRole('button', { name: /Stage 3.*Review suggestions/ }));
    fireEvent.change(screen.getByLabelText('How should the model guide this stage?'), { target: { value: 'My unsaved question remains here.' } });
    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: 'Try another question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('This draft changed in another session. Your unsaved text remains in the editor.')).toBeVisible();
    expect(screen.getByLabelText('How should the model guide this stage?')).toHaveValue('My unsaved question remains here.');
    fireEvent.click(screen.getByRole('button', { name: 'Load server revision 2' }));
    expect(screen.getByLabelText('How should the model guide this stage?')).toHaveValue('Ask the student to name the missing relation.');
  });
});

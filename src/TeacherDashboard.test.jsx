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

const partOneStages = {
  'add-source': { guidance: 'Ask the student to identify the memo passages they will use first.', materials: 'Excerpt from the course guide.' },
  'review-suggestions': { guidance: 'Ask one focused question without completing the analysis.', materials: 'Course reading on relationships.' },
  'choose-what-to-map': { guidance: 'Ask the student to choose people, groups, and connections supported by the memo.', materials: '' },
  'build-map': { guidance: 'Ask what each relationship does.', materials: '' },
  'revise-and-export': { guidance: 'Ask what changed and what the student will share.', materials: '' },
};

const partTwoStages = {
  'add-source': { guidance: 'Ask the student to add public institutions, policies, and community knowledge.', materials: 'Excerpt from the course guide on public systems.' },
  'review-suggestions': { guidance: 'Ask which evidence supports the larger pattern.', materials: 'Course reading on institutional power.' },
  'choose-what-to-map': { guidance: 'Ask the student to choose cross-scale relationships.', materials: '' },
  'build-map': { guidance: 'Ask how policy and community assets shape the map.', materials: '' },
  'revise-and-export': { guidance: 'Ask the student to explain assumptions and possible consequences.', materials: '' },
};

const profileValue = {
  schemaVersion: 'cuny.course-progression.v3',
  parts: [
    {
      id: 'part-1',
      label: 'Part 1',
      scaleIds: ['micro', 'meso'],
      stages: partOneStages,
    },
    {
      id: 'part-2',
      label: 'Part 2',
      scaleIds: ['exosphere', 'macrosphere'],
      stages: partTwoStages,
    },
  ],
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
  runtimes: [{ id: 'deterministic', label: 'Course guidance', teacherModulesAffectOutput: false, disclosure: 'Teacher edits are recorded with the run but do not change deterministic scoring.' }],
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
  content: 'Suggest map entries supported by the memo for the student to confirm.',
};

const submissionSummary = {
  id: 'submission-01',
  projectId: 'project-01',
  projectMetadata: { id: 'project-01', title: 'Access pathways memo', participantName: 'East Harlem Disability Services team' },
  activeScale: 'meso',
  coursePart: { id: 'part-1', label: 'Part 1', scaleIds: ['micro', 'meso'] },
  inquiry: 'How does guidance shape access to advanced courses?',
  status: 'pending',
  decision: null,
  revision: 2,
  submittedAt: '2026-08-08T13:00:00.000Z',
  updatedAt: '2026-08-08T13:00:00.000Z',
};

const suggestion = {
  guidance: [{
    point: 'Ask who carries information between the service team and families.',
    evidenceExcerpt: 'Prior access shaped who knew which services to request.',
  }],
  nodes: [{
    label: 'East Harlem Disability Services team',
    type: 'organization',
    scale: 'meso',
    evidence: 'Staff described organized students as already planning ahead.',
  }, {
    label: 'Family caregivers',
    type: 'family',
    scale: 'meso',
    evidence: 'Families relied on staff to explain available services.',
  }],
  connections: [{
    source: 'East Harlem Disability Services team',
    target: 'Family caregivers',
    verb: 'shares access information with',
    rationale: 'Prior access shaped who knew which services to request.',
  }],
  example: null,
  readiness: { ready: true, note: 'The memo supports a first Meso map.' },
  evaluatedAt: '2026-08-08T12:58:00.000Z',
};

const submissionDetail = {
  ...submissionSummary,
  sourceMaterial: 'Staff described organized students as already planning ahead. Prior access shaped who knew which courses to request.',
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
    const previewProfile = profiles.find(({ id }) => String(path).startsWith(`/api/teacher/profiles/${id}/preview?`));
    if (previewProfile) return jsonResponse({
      revision: previewProfile.revision,
      profileId: previewProfile.id,
      part: { id: 'part-2', label: 'Part 2' },
      scale: String(path).includes('scale=macrosphere') ? 'macrosphere' : 'micro',
      guidance: 'SAVED GUIDANCE FOR THIS SECTION',
      materials: 'SAVED COURSE MATERIAL FOR THIS SECTION',
    });
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
  expect(await screen.findByText(submissionDetail.sourceMaterial)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Student or group' })).toBeVisible();
  expect(screen.getAllByText(submissionDetail.projectMetadata.participantName).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole('heading', { name: 'Memo' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Source' })).not.toBeInTheDocument();
  return screen.getByRole('group', { name: 'Feedback type' });
}

describe('TeacherDashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders an account-bound reset form and clears it after a successful passphrase change', async () => {
    const resetToken = 'A'.repeat(43);
    const onResetComplete = vi.fn();
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/auth/accounts') return jsonResponse({ teacherAccess });
      if (path === '/api/auth/me') return jsonResponse({ user: null });
      if (path === '/api/auth/reset-password') {
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ token: resetToken, passphrase: 'a newly chosen teacher phrase' });
        return jsonResponse({ reset: true });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TeacherDashboard resetToken={resetToken} onResetComplete={onResetComplete} onConfigurationChanged={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Choose new passphrase' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('New passphrase'), { target: { value: 'a newly chosen teacher phrase' } });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), { target: { value: 'a newly chosen teacher phrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new passphrase' }));
    await waitFor(() => expect(onResetComplete).toHaveBeenCalledTimes(1));
  });

  it('defaults to the pending review queue and offers three advisory feedback modes', async () => {
    const fetchMock = await renderAuthenticated();
    expect(screen.getByText('Review student work and manage course settings')).toBeVisible();
    const reviewTab = screen.getByRole('tab', { name: 'Review submissions' });
    const guidanceTab = screen.getByRole('tab', { name: 'Course settings' });
    expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    expect(reviewTab).toHaveAttribute('tabindex', '0');
    expect(guidanceTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('heading', { name: 'Available review records' })).toBeVisible();
    expect(await screen.findByRole('button', { name: /East Harlem Disability Services team/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByText('Part 1 · Meso-level')).not.toHaveLength(0);

    const feedbackGroup = await waitForSubmission();
    expect(within(feedbackGroup).getAllByRole('button')).toHaveLength(3);
    expect(within(feedbackGroup).getByRole('button', { name: 'Add feedback' })).toBeVisible();
    expect(within(feedbackGroup).getByRole('button', { name: 'Add feedback and a question' })).toBeVisible();
    expect(within(feedbackGroup).getByRole('button', { name: 'Recommend another pass' })).toBeVisible();
    expect(screen.getByText('Give the student one point to consider next. They can continue working while feedback is pending and decide how to use your response.')).toBeVisible();
    expect(screen.getByText(submissionDetail.inquiry)).toBeVisible();
    expect(screen.getByText(submissionDetail.studentAnnotation)).toBeVisible();
    const modelReview = screen.getByText('Review details').closest('details');
    expect(modelReview).not.toHaveAttribute('open');
    expect(screen.getByText('You decide which suggestions the student should examine next.')).not.toBeVisible();
    fireEvent.click(screen.getByText('Review details'));
    expect(modelReview).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Memo evidence' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Map ideas' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Questions to consider' })).toBeVisible();
    expect(screen.getAllByText('Prior access shaped who knew which services to request.')).not.toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Write to student' })).toBeVisible();
    expect(screen.getByLabelText('Feedback for the student')).toBeVisible();
    expect(screen.getByText(/Give the student one point/)).toBeVisible();
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/modules');
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/history?limit=60');
  });

  it('falls back to the project title when no student or group name was provided', async () => {
    const unnamedSummary = {
      ...submissionSummary,
      projectMetadata: { id: 'project-01', title: 'Access pathways memo' },
    };
    const unnamedDetail = {
      ...submissionDetail,
      projectMetadata: unnamedSummary.projectMetadata,
    };
    await renderAuthenticated(authenticatedFetch({ queue: [unnamedSummary], detail: unnamedDetail }));

    expect(await screen.findByRole('button', { name: /Access pathways memo/ })).toHaveAttribute('aria-current', 'true');
    expect(await screen.findByText(unnamedDetail.sourceMaterial)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Student or group' })).not.toBeInTheDocument();
  });

  it('keeps model scores and gate labels out of the instructor-facing pedagogical review', async () => {
    const holdSuggestion = {
      hardPass: false,
      score: 7,
      threshold: 6,
      outcome: 'hold',
      hard: Array.from({ length: 4 }, (_, index) => ({
        id: `H${index + 1}`,
        status: index === 3 ? 'unmet' : 'met',
        evidence: index === 3 ? '' : `Hard-gate evidence ${index + 1}`,
        rationale: index === 3 ? 'The memo names only one clear connection.' : 'The check is supported.',
        nextAction: index === 3 ? 'Add a second connection.' : '',
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

    fireEvent.click(screen.getByText('Review details'));
    expect(screen.getByRole('heading', { name: 'Evidence excerpts' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Possible next step' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Open questions' })).toBeVisible();
    expect(screen.queryByText(/^hold$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/threshold 6/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^H4$/)).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Sign in to Teacher Console' })).toBeVisible();
    expect(screen.queryByText('Maria Mavrides Calderon')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Teacher account ID'), { target: { value: '  local-teacher-id  ' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a locally chosen phrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Teacher Console' })).toBeVisible();
    expect(loginBody).toEqual({ userId: 'local-teacher-id', passphrase: 'a locally chosen phrase' });
    expect(await screen.findByText('No review records are available. The current student workflow does not send work to this queue.')).toBeVisible();
    expect(screen.queryByText(/send your work here|submit your map for review/i)).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Sign in to Teacher Console' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Set up account' }));
    fireEvent.change(screen.getByLabelText('Teacher account ID'), { target: { value: 'local-teacher-id' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'another local phrase' } });
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: 'another local phrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the one-time setup code.');
    expect(claimBody).toBeNull();

    fireEvent.change(screen.getByLabelText('One-time setup code'), { target: { value: 'operator-only-bootstrap-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up account' }));
    expect(await screen.findByRole('heading', { name: 'Teacher Console' })).toBeVisible();
    expect(claimBody).toEqual({ userId: 'local-teacher-id', passphrase: 'another local phrase', bootstrapToken: 'operator-only-bootstrap-token' });
  });

  it('requires a focus for the student before feedback is recorded', async () => {
    const fetchMock = await renderAuthenticated();
    const feedbackGroup = await waitForSubmission();
    fireEvent.click(within(feedbackGroup).getByRole('button', { name: 'Add feedback' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write feedback for the student before recording it.');
    expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/decision'))).toBe(false);
  });

  it('discloses one focused-question field only for feedback with a question', async () => {
    await renderAuthenticated();
    const feedbackGroup = await waitForSubmission();
    expect(screen.queryByLabelText('Question for the student')).not.toBeInTheDocument();
    fireEvent.click(within(feedbackGroup).getByRole('button', { name: 'Add feedback and a question' }));
    expect(screen.getByLabelText('Question for the student')).toBeVisible();
    expect(screen.getAllByLabelText('Question for the student')).toHaveLength(1);
    fireEvent.click(within(feedbackGroup).getByRole('button', { name: 'Recommend another pass' }));
    expect(screen.queryByLabelText('Question for the student')).not.toBeInTheDocument();
  });

  it('records feedback, removes the submission after queue refresh, and shows returned append-only history', async () => {
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
    const feedbackGroup = await waitForSubmission();
    fireEvent.change(screen.getByLabelText('Feedback for the student'), { target: { value: `  ${event.instructorAnnotation}  ` } });
    fireEvent.click(within(feedbackGroup).getByRole('button', { name: 'Add feedback' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));

    expect(await screen.findByText('No review records are available. The current student workflow does not send work to this queue.')).toBeVisible();
    expect(screen.getByText('Feedback recorded. This review record is no longer pending.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Latest feedback' })).toBeVisible();
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
    const feedbackGroup = await waitForSubmission();
    fireEvent.change(screen.getByLabelText('Feedback for the student'), { target: { value: 'Keep the distinction between memo details and your interpretation.' } });
    fireEvent.click(within(feedbackGroup).getByRole('button', { name: 'Add feedback and a question' }));
    fireEvent.change(screen.getByLabelText('Question for the student'), { target: { value: 'Which advising example best supports this connection?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));

    expect(await screen.findByText('Another session changed this submission after you opened it. Your feedback remains in the form.')).toBeVisible();
    expect(screen.getByLabelText('Feedback for the student')).toHaveValue('Keep the distinction between memo details and your interpretation.');
    expect(screen.getByLabelText('Question for the student')).toHaveValue('Which advising example best supports this connection?');
    fireEvent.click(screen.getByRole('button', { name: 'Reload current submission' }));
    expect(screen.getByText('Loaded submission revision 3. Your feedback remains in the form.')).toBeVisible();
    expect(screen.getByLabelText('Feedback for the student')).toHaveValue('Keep the distinction between memo details and your interpretation.');
    expect(screen.getByLabelText('Question for the student')).toHaveValue('Which advising example best supports this connection?');

    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));
    await waitFor(() => expect(postBodies).toHaveLength(2));
    expect(postBodies[0]).toEqual({
      decision: 'revise_and_approve',
      instructorAnnotation: 'Keep the distinction between memo details and your interpretation.',
      focusedQuestion: 'Which advising example best supports this connection?',
      expectedRevision: 2,
    });
    expect(postBodies[1]).toMatchObject({ expectedRevision: 3, decision: 'revise_and_approve' });
  });

  it('lazy-loads compact Part, Level, and Section controls with version details collapsed', async () => {
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
    expect(screen.getByText('Set guidance and course material for each section of the exercise.')).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('Course settings are saved but not sent to the model. The application does not call the model in this section.');
    const versionDetails = screen.getByText('Versions and change history').closest('details');
    expect(versionDetails).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Version')).not.toBeVisible();
    expect(await screen.findByLabelText('Part')).toHaveValue('part-1');
    expect(screen.getByLabelText('Preview level')).toHaveValue('micro');
    expect(within(screen.getByLabelText('Preview level')).getAllByRole('option').map(({ value }) => value)).toEqual(['micro', 'meso']);
    expect(screen.getByText('Guidance and course material for this section apply to Micro-level and Meso-level.')).toBeVisible();
    expect(screen.getByLabelText('Section')).toHaveValue('add-source');
    expect(within(screen.getByLabelText('Section')).getAllByRole('option')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Review memo' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Instructor guidance for this section')).toHaveValue(partOneStages['add-source'].guidance);
    expect(screen.getByLabelText('Course material for this section')).toHaveValue(partOneStages['add-source'].materials);
    fireEvent.change(await screen.findByLabelText('Section'), { target: { value: 'review-suggestions' } });
    expect(screen.getByRole('note')).toHaveTextContent("Built-in suggestions are active. The console saves this section's guidance and course material, but built-in suggestions do not use them.");
    expect(screen.getByLabelText('Instructor guidance for this section')).toHaveValue(partOneStages['review-suggestions'].guidance);
    expect(screen.getByLabelText('Course material for this section')).toHaveValue(partOneStages['review-suggestions'].materials);
    fireEvent.change(screen.getByLabelText('Part'), { target: { value: 'part-2' } });
    expect(screen.getByLabelText('Preview level')).toHaveValue('exosphere');
    expect(within(screen.getByLabelText('Preview level')).getAllByRole('option').map(({ value }) => value)).toEqual(['exosphere', 'macrosphere']);
    expect(screen.getByLabelText('Instructor guidance for this section')).toHaveValue(partTwoStages['review-suggestions'].guidance);
    expect(screen.getByLabelText('Course material for this section')).toHaveValue(partTwoStages['review-suggestions'].materials);
    fireEvent.change(screen.getByLabelText('Preview level'), { target: { value: 'macrosphere' } });
    const previewPanel = screen.getByRole('heading', { name: 'Preview this section' }).closest('aside');
    expect(previewPanel).toHaveTextContent('Part 2 · Macro-level · Review memo');
    expect(previewPanel).toHaveTextContent('Broader laws, public policies, economic conditions, histories, and cultural beliefs that affect more than one map item.');
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved section' }));
    expect(await screen.findByText('Saved version 1')).toBeVisible();
    expect(screen.getByLabelText('Course guidance sent to the model')).toHaveTextContent('SAVED GUIDANCE FOR THIS SECTION');
    expect(screen.getByLabelText('Course guidance sent to the model')).toHaveTextContent('SAVED COURSE MATERIAL FOR THIS SECTION');
    expect(screen.queryByText('FULL SAVED PROMPT FOR THIS SECTION')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => String(path))).toContain('/api/teacher/profiles/systems-mapping-default/preview?configKind=preflight&scale=macrosphere&stageId=review-suggestions');
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'choose-what-to-map' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved section' }));
    await waitFor(() => expect(fetchMock.mock.calls.map(([path]) => String(path))).toContain('/api/teacher/profiles/systems-mapping-default/preview?configKind=builder&scale=macrosphere&stageId=choose-what-to-map'));
    expect(screen.getByText('Edit the guidance and course material for one section at a time.')).toBeVisible();
    expect(screen.queryByLabelText('Module')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/teacher/profiles')).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/teacher/modules');

    fireEvent.click(screen.getByText('Versions and change history'));
    expect(versionDetails).toHaveAttribute('open');
    expect(screen.getByLabelText('Version')).toBeVisible();
    expect(screen.getByLabelText('Version name')).toBeVisible();
    expect(screen.getByText('No change history is available.')).toBeVisible();

    fireEvent.keyDown(guidanceTab, { key: 'Home' });
    expect(reviewTab).toHaveFocus();
    expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(guidanceTab);
    expect(await screen.findByRole('heading', { name: 'Course settings' })).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/teacher/profiles')).toHaveLength(1);
  });

  it('describes model-backed level requests without collapsing their jobs', async () => {
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/auth/accounts') return jsonResponse({ teacherAccess });
      if (path === '/api/auth/me') return jsonResponse({ user: teacher });
      if (path === '/api/teacher/preflight-submissions?status=pending') return jsonResponse({ submissions: [] });
      if (path === '/api/teacher/profiles') return jsonResponse({
        resource,
        runtime: { provider: 'openrouter', model: 'openai/gpt-oss-120b' },
        activeProfileId: activeProfile.id,
        profiles: [{ ...activeProfile, profile: undefined }],
      });
      if (path === `/api/teacher/profiles/${activeProfile.id}`) return jsonResponse({ profile: activeProfile, events: [] });
      throw new Error(`Unhandled fetch: ${path} ${options.method || 'GET'}`);
    });
    global.fetch = fetchMock;
    render(<TeacherDashboard onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Course settings' }));
    expect(await screen.findByRole('heading', { name: 'Course settings' })).toBeVisible();
    fireEvent.change(await screen.findByLabelText('Section'), { target: { value: 'review-suggestions' } });
    expect(screen.getByRole('note')).toHaveTextContent("Model guidance is active. The model uses this section's guidance and course material to suggest Micro-level elements and direct relationships from the memo.");
    fireEvent.change(screen.getByLabelText('Preview level'), { target: { value: 'meso' } });
    expect(screen.getByRole('note')).toHaveTextContent("The model uses this section's guidance and course material to suggest Meso-level linkages across at least two Micro-level settings.");
    fireEvent.change(screen.getByLabelText('Part'), { target: { value: 'part-2' } });
    fireEvent.change(screen.getByLabelText('Preview level'), { target: { value: 'macrosphere' } });
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'choose-what-to-map' } });
    expect(screen.getByRole('note')).toHaveTextContent("The model uses this section's guidance and course material when students request more Macro-level conditions or change which mapped elements they affect.");
    expect(screen.getByRole('note')).not.toHaveTextContent('connections');
  });

  it('creates, saves, and publishes selected-section guidance without editing the published version in place', async () => {
    const intakeQuestions = [{ id: 'question-1', text: '  Keep this legacy question unchanged\n', required: false }];
    const draftProfile = { ...activeProfile, profile: { ...profileValue, intakeQuestions }, id: 'draft-profile-identifier-000001', name: 'Evidence guidance', status: 'draft', parentId: activeProfile.id };
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
    fireEvent.click(screen.getByText('Versions and change history'));
    fireEvent.click(screen.getByRole('button', { name: 'Create a draft' }));
    fireEvent.change(screen.getByLabelText('Draft name'), { target: { value: 'Evidence guidance' } });
    fireEvent.change(screen.getByLabelText('What do you plan to change?'), { target: { value: 'Focus prompts on relationships' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(screen.getByLabelText('Version name')).toHaveValue('Evidence guidance'));
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'review-suggestions' } });
    const guidanceField = screen.getByLabelText('Instructor guidance for this section');
    fireEvent.click(screen.getByRole('button', { name: 'Add Micro-level note' }));
    expect(guidanceField).toHaveValue(`${partOneStages['review-suggestions'].guidance}\n\nMicro-level: `);
    expect(screen.getByText('Optional level notes can focus a question or course example. Fixed level definitions and map rules stay unchanged.')).toBeVisible();
    fireEvent.change(guidanceField, { target: { value: 'Return first to evidence that names a relationship.\n\nMicro-level: Ask the student to name the direct action.' } });
    fireEvent.change(screen.getByLabelText('Course material for this section'), { target: { value: 'Use the class reading on people, organizations, and connections.' } });
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview saved section' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: 'Focus the evidence prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft revision 2 saved.')).toBeVisible();
    expect(screen.getByText('Draft saved')).toBeVisible();
    const savedBody = requests.find(([path, method]) => path === `/api/teacher/profiles/${draftProfile.id}` && method === 'PUT')?.[2];
    expect(savedBody.profile.intakeQuestions).toEqual(intakeQuestions);
    expect(savedBody.profile.parts[0]).toMatchObject({ id: 'part-1', label: 'Part 1', scaleIds: ['micro', 'meso'] });
    expect(savedBody.profile.parts[0].stages['review-suggestions']).toEqual({
      guidance: 'Return first to evidence that names a relationship.\n\nMicro-level: Ask the student to name the direct action.',
      materials: 'Use the class reading on people, organizations, and connections.',
    });
    expect(savedBody.profile.parts[1]).toEqual(profileValue.parts[1]);
    expect(onConfigurationChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: 'Publish the evidence guidance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish draft' }));
    expect(await screen.findByText('Draft published. These course settings are now current.')).toBeVisible();
    expect(screen.getByText('Published')).toBeVisible();
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
        parts: profileValue.parts.map((part) => part.id === 'part-1' ? {
          ...part,
          stages: {
            ...part.stages,
            'review-suggestions': {
              ...part.stages['review-suggestions'],
              guidance: 'Ask the student to name the missing relation.',
            },
          },
        } : part),
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
    fireEvent.click(screen.getByText('Versions and change history'));
    fireEvent.change(screen.getByLabelText('Version', { exact: true }), { target: { value: draftProfile.id } });
    await waitFor(() => expect(screen.getByLabelText('Version name')).toHaveValue('Question guidance'));
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'review-suggestions' } });
    fireEvent.change(screen.getByLabelText('Instructor guidance for this section'), { target: { value: 'My unsaved question remains here.' } });
    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: 'Try another question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Another session saved a newer revision of this draft. Your unsaved text remains in the editor.')).toBeVisible();
    expect(screen.getByLabelText('Instructor guidance for this section')).toHaveValue('My unsaved question remains here.');
    fireEvent.click(screen.getByRole('button', { name: 'Load server revision 2' }));
    expect(screen.getByLabelText('Instructor guidance for this section')).toHaveValue('Ask the student to name the missing relation.');
  });
});

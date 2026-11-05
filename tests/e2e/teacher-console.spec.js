import {
  assertNoAccessibilityViolations,
  captureSourceRenderedScreenshot,
  expect,
  scanAccessibility,
  test,
} from './support/test.js';
import { DEFAULT_TEACHING_PROFILE, SYSTEMS_MAPPING_EDUCATOR_RESOURCE } from '../../server/config.js';

// UI fixtures exercise the real built application without creating accounts,
// calling a model, or writing feedback to a live course.
const submission = {
  id: 'teacher-layout-fixture',
  projectId: 'teacher-layout-project',
  projectMetadata: { title: 'Access memo', participantName: 'East Harlem group' },
  activeScale: 'micro',
  coursePart: { id: 'part-1', label: 'Part 1', scaleIds: ['micro', 'meso'] },
  status: 'pending',
  revision: 1,
  submittedAt: '2026-10-02T18:00:00.000Z',
  sourceMaterial: 'Rosa attends a weekly group at East Side Center. Jo brings a chair near the door. Rosa visits a clinic each month and carries her appointment card between the two places.',
  studentAnnotation: 'I want to check who arranges the appointment time',
  inquiry: 'Who helps Rosa attend appointments?',
  suggestion: {
    guidance: [{ point: 'Who checks the appointment time?', evidenceExcerpt: 'Rosa carries her appointment card between the two places.' }],
    nodes: [{ label: 'Rosa', scale: 'micro', evidence: 'Rosa attends a weekly group at East Side Center.' }],
    connections: [],
  },
};

async function openTeacherFixture(page, submissions) {
  await page.route('**/api/auth/accounts', (route) => route.fulfill({ json: { teacherAccess: { mode: 'manual', claimEnabled: false } } }));
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'teacher-layout-user', displayName: 'Course instructor' } } }));
  await page.route('**/api/teacher/preflight-submissions?status=pending', (route) => route.fulfill({ json: { submissions } }));
  await page.route(`**/api/teacher/preflight-submissions/${submission.id}`, (route) => route.fulfill({ json: { submission, reviewEvents: [] } }));
  await page.goto('/');
  await expect(page).toHaveTitle('Systems Mapping');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Instructor Console', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Instructor Console', exact: true })).toBeVisible();
}

// Playwright 1.62's WebKit screenshot synchronization injects an inert `body {}`
// stylesheet even with animations allowed. CSP correctly blocks it once per
// capture. Match that exact count; every additional application error still fails.
function screenshotWarnings(browserName, captures) {
  return browserName === 'webkit' ? Array(captures).fill("Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.") : [];
}

async function assertFittedLayout(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  const headers = await page.locator('.review-column-heading h2').evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
  }));
  expect(new Set(headers.map((header) => JSON.stringify(header))).size).toBe(1);
}

test('instructor console empty queue is compact and returns to the application', async ({ page, makeAxeBuilder, browserName }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await openTeacherFixture(page, []);
  await expect(page.getByText('No submissions yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Submissions', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Feedback', exact: true })).toHaveCount(0);
  expect(await page.locator('.teacher-review-grid').evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(200);
  await assertFittedLayout(page);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'teacher empty queue'));
  await captureSourceRenderedScreenshot(page, testInfo, 'teacher empty queue');
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'teacher empty queue dark'));
  await captureSourceRenderedScreenshot(page, testInfo, 'teacher empty queue dark');
  await page.getByRole('button', { name: 'Back to class access', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Class code' })).toBeVisible();
  expect(errors).toEqual(screenshotWarnings(browserName, 2));
});

test('instructor console stages work and feedback with normalized headings', async ({ page, makeAxeBuilder, browserName }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await openTeacherFixture(page, [submission]);
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Feedback', exact: true })).toBeVisible();
  await expect(page.getByText(submission.sourceMaterial, { exact: true })).toBeVisible();
  await assertFittedLayout(page);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'teacher selected submission'));
  await page.getByRole('heading', { name: 'Work', exact: true }).scrollIntoViewIfNeeded();
  await captureSourceRenderedScreenshot(page, testInfo, 'teacher selected work');
  await page.getByLabel('Feedback for the student', { exact: true }).fill('Check who confirms the appointment time');
  await page.getByRole('button', { name: 'Feedback and question', exact: true }).click();
  await expect(page.getByLabel('Question for the student', { exact: true })).toBeVisible();
  await page.getByLabel('Question for the student', { exact: true }).fill('Who calls the clinic?');
  await page.getByRole('heading', { name: 'Feedback', exact: true }).scrollIntoViewIfNeeded();
  await captureSourceRenderedScreenshot(page, testInfo, 'teacher selected feedback');
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'teacher selected feedback dark'));
  await captureSourceRenderedScreenshot(page, testInfo, 'teacher selected feedback dark');
  expect(errors).toEqual(screenshotWarnings(browserName, 3));
});

test('instructor edits Field Notes by scale and publishes the saved questions', async ({ page, makeAxeBuilder }, testInfo) => {
  const questions = { micro: 'Whose direct relationships are missing?', meso: 'What connects the home and school settings?' };
  let current = { id: 'field-notes-fixture', name: 'Field Notes draft', status: 'draft', revision: 1, profile: structuredClone(DEFAULT_TEACHING_PROFILE) };
  const writes = [];
  await page.route('**/api/teacher/profiles', route => route.fulfill({ json: {
    resource: SYSTEMS_MAPPING_EDUCATOR_RESOURCE,
    runtime: { provider: 'deterministic', model: 'STEM Splitter' },
    activeProfileId: current.id, profiles: [current],
  } }));
  await page.route(`**/api/teacher/profiles/${current.id}`, async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      writes.push(body);
      current = { ...current, ...body, revision: 2 };
    }
    await route.fulfill({ json: { profile: current, events: [] } });
  });
  await page.route(`**/api/teacher/profiles/${current.id}/publish`, async route => {
    expect(route.request().postDataJSON().expectedRevision).toBe(2);
    current = { ...current, status: 'active' };
    await route.fulfill({ json: { profile: current, events: [] } });
  });
  await openTeacherFixture(page, []);
  await page.getByRole('tab', { name: 'Course settings' }).click();
  await expect(page.getByLabel('Scale', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Mapping step', { exact: true })).not.toBeVisible();
  expect(await page.locator('.course-prompt-editor textarea:visible').count()).toBe(1);
  for (const [scale, question] of Object.entries(questions)) {
    await page.getByLabel('Scale', { exact: true }).selectOption(scale);
    await page.getByRole('textbox', { name: 'Field Notes prompt', exact: true }).fill(question);
  }
  await page.getByLabel('Scale', { exact: true }).selectOption('micro');
  await expect(page.getByRole('textbox', { name: 'Field Notes prompt', exact: true })).toHaveValue(questions.micro);
  await expect(page.getByRole('button', { name: 'Publish changes', exact: true })).toBeEnabled();
  await page.getByText('Versions', { exact: true }).click();
  await page.getByLabel('Change note (optional)', { exact: true }).fill('Adapt the questions to the field site');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft revision 2 saved.')).toBeAttached();
  expect(writes).toHaveLength(1);
  expect(writes[0].profile.fieldNotesQuestions).toMatchObject(questions);
  expect(writes[0].profile.parts).toEqual(DEFAULT_TEACHING_PROFILE.parts);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Field Notes instructor editor'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Field Notes instructor editor');
  await page.getByLabel('Change note (optional)', { exact: true }).fill('Publish the questions for this fieldwork cycle');
  await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
  await expect(page.getByText('Published.', { exact: true })).toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Field Notes prompt', exact: true })).toHaveAttribute('readonly', '');
});

test('lesson customization opens an editable copy and publishes directly from the prompt editor', async ({ page, makeAxeBuilder, browserName }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  let published = { id: 'published-lesson-prompts', name: 'Course prompts', status: 'active', revision: 1, profile: structuredClone(DEFAULT_TEACHING_PROFILE) };
  let draft = null;
  const writes = [];
  await page.route('**/api/config/public?**', route => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { configKind: params.get('configKind'), scale: params.get('scale'), stageId: params.get('stageId'), fingerprint: 'f'.repeat(64), revision: 2, moduleVersions: [], fieldNotesQuestions: published.profile.fieldNotesQuestions } });
  });
  await page.route('**/api/teacher/profiles', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.sourceProfileId).toBe(published.id);
      draft = { ...published, id: 'lesson-prompt-draft', name: body.name, status: 'draft' };
      writes.push({ method: 'CREATE' });
      return route.fulfill({ status: 201, json: { profile: draft, events: [] } });
    }
    await route.fulfill({ json: {
      resource: SYSTEMS_MAPPING_EDUCATOR_RESOURCE,
      runtime: { provider: 'deterministic', model: 'STEM Splitter' },
      activeProfileId: published.id, profiles: [published, ...(draft && draft.id !== published.id ? [draft] : [])],
    } });
  });
  await page.route('**/api/teacher/profiles/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(1);
      draft = { ...draft, name: body.name, profile: body.profile, revision: 2 };
      writes.push({ method: 'SAVE', profile: draft.profile });
      return route.fulfill({ json: { profile: draft, events: [] } });
    }
    if (path.endsWith('/publish')) {
      expect(route.request().postDataJSON().expectedRevision).toBe(2);
      published = { ...draft, status: 'active' };
      writes.push({ method: 'PUBLISH' });
      return route.fulfill({ json: { profile: published, events: [] } });
    }
    return route.fulfill({ json: { profile: draft && path.endsWith(draft.id) ? draft : published, events: [] } });
  });
  await openTeacherFixture(page, []);
  await page.getByRole('tab', { name: 'Course settings' }).click();
  await expect(page.getByRole('button', { name: 'Edit prompts', exact: true })).toBeVisible();
  const account = page.getByText('Account', { exact: true });
  await account.click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Field Notes prompt', exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Draft name')).toHaveCount(0);
  await expect(page.getByLabel('Version', { exact: true })).not.toBeVisible();
  expect(await page.locator('.course-settings textarea:visible').count()).toBe(1);
  const actionBox = await page.getByRole('button', { name: 'Edit prompts', exact: true }).boundingBox();
  const promptBox = await page.getByRole('textbox', { name: 'Field Notes prompt', exact: true }).boundingBox();
  expect(actionBox.y + actionBox.height).toBeLessThan(promptBox.y);
  for (const name of ['Student preview', 'Guidance and materials', 'Versions']) {
    const summary = page.locator('summary').filter({ hasText: name });
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary.locator('..')).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(summary.locator('..')).not.toHaveAttribute('open', '');
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('button', { name: 'Edit prompts', exact: true })).toBeInViewport({ ratio: 1 });
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Course customization published'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Course customization published');
  await page.getByRole('button', { name: 'Edit prompts', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Field Notes prompt', exact: true });
  await expect(field).not.toHaveAttribute('readonly', '');
  const question = 'Using our library case and this week’s reading, whose direct relationships are missing?\n\nPlan an observation and identify a link between the focal person’s everyday settings to investigate at Meso.';
  await field.fill(question);
  await page.getByText('Student preview', { exact: true }).click();
  await expect(page.locator('.course-student-preview__question')).toHaveText(question);
  expect(await page.locator('.course-student-preview__question').innerText()).toBe(question.replace(/\s+/g, ' '));
  await page.getByRole('button', { name: 'Publish changes', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Publish changes', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByLabel('Change note (optional)')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Course customization preview'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Course customization preview');
  await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
  await expect(page.getByText('Published.', { exact: true })).toBeAttached();
  await expect(field).toHaveAttribute('readonly', '');
  expect(writes.map(write => write.method)).toEqual(['CREATE', 'SAVE', 'PUBLISH']);
  expect(writes[1].profile.fieldNotesQuestions.micro).toBe(question);
  expect(writes[1].profile.fieldNotesQuestions.meso).toBe(DEFAULT_TEACHING_PROFILE.fieldNotesQuestions.meso);
  expect(errors).toEqual(screenshotWarnings(browserName, 2));
});

test('compact course materials import previews, cancels, saves, and preserves errors', async ({ page, makeAxeBuilder }, testInfo) => {
  let current = { id: 'compact-course', name: 'Synthetic course', status: 'draft', revision: 1, profile: structuredClone(DEFAULT_TEACHING_PROFILE) };
  const original = 'Existing course reference.';
  current.profile.parts[0].stages['add-source'].materials = original;
  let failSave = false;
  await page.route('**/api/teacher/profiles', route => route.fulfill({ json: { resource: SYSTEMS_MAPPING_EDUCATOR_RESOURCE, runtime: { provider: 'deterministic' }, activeProfileId: current.id, profiles: [current] } }));
  await page.route(`**/api/teacher/profiles/${current.id}`, async route => {
    if (route.request().method() === 'PUT') {
      if (failSave) return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Temporarily unavailable' } } });
      current = { ...current, ...route.request().postDataJSON(), revision: current.revision + 1 };
    }
    return route.fulfill({ json: { profile: current, events: [] } });
  });
  await openTeacherFixture(page, []);
  await page.getByRole('tab', { name: 'Course settings' }).click();
  const guidance = page.locator('.course-model-settings');
  await expect(guidance).not.toHaveAttribute('open', '');
  await page.getByText('Guidance and materials', { exact: true }).click();
  await expect(page.locator('.course-model-preview-panel')).not.toHaveAttribute('open', '');
  const material = page.getByRole('textbox', { name: 'Course material', exact: true });
  const upload = page.getByLabel('Upload course material', { exact: true });
  await upload.setInputFiles({ name: 'reading.txt', mimeType: 'text/plain', buffer: Buffer.from('Observe who connects the two settings.') });
  await expect(page.getByRole('region', { name: 'Course material import preview' })).toBeVisible();
  await expect(material).toHaveValue(original);
  await page.getByText('Cancel import', { exact: true }).click();
  await expect(material).toHaveValue(original);
  for (const name of ['east-harlem-memo.docx', 'east-harlem-memo.pdf']) {
    await upload.setInputFiles(new URL(`./fixtures/memo-uploads/${name}`, import.meta.url).pathname);
    await expect(page.getByRole('region', { name: 'Course material import preview' })).toBeVisible();
    await expect(material).toHaveValue(original);
    await page.getByText('Cancel import', { exact: true }).click();
  }
  await upload.setInputFiles({ name: 'reading.txt', mimeType: 'text/plain', buffer: Buffer.from('Observe who connects the two settings.') });
  await page.getByText('Append to course material', { exact: true }).click();
  const combined = `${original}\n\nObserve who connects the two settings.`;
  await expect(material).toHaveValue(combined);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft revision 2 saved.', { exact: true })).toBeAttached();
  expect(current.profile.parts[0].stages['add-source'].materials).toBe(combined);
  await page.getByRole('tab', { name: 'Submissions' }).click();
  await page.getByRole('tab', { name: 'Course settings' }).click();
  // Section state may remain open while mounted; content must remain unchanged.
  if (!(await guidance.evaluate(el => el.open))) await page.getByText('Guidance and materials', { exact: true }).click();
  await expect(material).toHaveValue(combined);
  await upload.setInputFiles({ name: 'too-long.txt', mimeType: 'text/plain', buffer: Buffer.from('x'.repeat(4001)) });
  await expect(page.getByRole('alert')).toContainText('too large');
  await expect(material).toHaveValue(combined);
  await upload.setInputFiles({ name: 'reading.txt', mimeType: 'text/plain', buffer: Buffer.from('Another passage.') });
  await page.getByText('Cancel import', { exact: true }).click();
  await material.fill(combined + '\nUnsaved addition.'); failSave = true;
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(material).toHaveValue(combined + '\nUnsaved addition.');
  failSave = false;
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft revision 3 saved.', { exact: true })).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Compact course materials'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Compact course materials');
});

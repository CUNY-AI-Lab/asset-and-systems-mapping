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
  await page.getByRole('button', { name: 'Teacher Console', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Teacher Console', exact: true })).toBeVisible();
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

test('teacher console empty queue is compact and returns to the application', async ({ page, makeAxeBuilder, browserName }, testInfo) => {
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

test('teacher console stages work and feedback with normalized headings', async ({ page, makeAxeBuilder, browserName }, testInfo) => {
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
  await page.getByRole('button', { name: 'Add feedback and a question', exact: true }).click();
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
  expect(await page.locator('.teaching-profile-editor textarea:visible').count()).toBe(1);
  for (const [scale, question] of Object.entries(questions)) {
    await page.getByLabel('Scale', { exact: true }).selectOption(scale);
    await page.getByLabel('Required Field Notes question').fill(question);
  }
  await page.getByLabel('Scale', { exact: true }).selectOption('micro');
  await expect(page.getByLabel('Required Field Notes question')).toHaveValue(questions.micro);
  await expect(page.getByRole('button', { name: 'Publish draft', exact: true })).toBeDisabled();
  await page.getByLabel('Change note', { exact: true }).fill('Adapt the questions to the field site');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft revision 2 saved.')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].profile.fieldNotesQuestions).toMatchObject(questions);
  expect(writes[0].profile.parts).toEqual(DEFAULT_TEACHING_PROFILE.parts);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Field Notes instructor editor'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Field Notes instructor editor');
  await page.getByLabel('Change note', { exact: true }).fill('Publish the questions for this fieldwork cycle');
  await page.getByRole('button', { name: 'Publish draft', exact: true }).click();
  await expect(page.getByText('Draft published. These course settings are now current.')).toBeVisible();
  await expect(page.getByLabel('Required Field Notes question')).toHaveAttribute('readonly', '');
});

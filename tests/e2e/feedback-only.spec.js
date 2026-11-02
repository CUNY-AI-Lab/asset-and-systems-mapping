import { test, expect, captureSourceRenderedScreenshot } from './support/test.js';
import { mapCommand, notebookSection } from './support/notebook.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

const memo = 'A fictional parent visits the school office. A coordinator helps the parent complete a transport request form. The parent says the bus arrived late twice. The memo does not establish why.';
const readProject = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);

test('feedback-only results remain visible and a reread preserves the map', async ({ page }, testInfo) => {
  let evaluations = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Exercise the real UI with a fabricated memo and an intentionally partial
  // local server response. This does not test a model provider.
  await page.route('**/api/preflight/evaluations', async route => {
    evaluations += 1;
    const response = await route.fetch();
    const body = await response.json();
    body.evaluation.review = {
      guidance: [{ point: 'What evidence would explain the bus delays?' }],
      nodes: [], connections: [], example: null,
      readiness: { ready: false, note: 'Map suggestions could not be checked.' },
    };
    body.evaluation.runtime.feedbackOnly = true;
    await route.fulfill({ response, json: body });
  });

  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start new project' }).click();
  await page.getByRole('textbox', { name: /^Memo/ }).fill(memo);
  await page.getByRole('button', { name: 'Memo review', exact: true }).click();
  await page.getByRole('button', { name: 'Generate guidance', exact: true }).click();
  const feedback = page.getByText('What evidence would explain the bus delays?');
  const notice = page.getByText(/^The app could not use its map suggestions/);
  await expect(feedback).toBeVisible();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Check the feedback below against your memo and sources.');
  await expect.poll(async () => (await readProject(page)).preflight?.evaluation?.runtime?.feedbackOnly).toBe(true);
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await expect(page.getByText('Add an item on the map or reread the memo.')).toBeVisible();
  await expect(page.getByText('No suggestions. Revise the memo and reread it, or add items on the map.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish review', exact: true }).click();

  await mapCommand(page, 'Add item');
  const form = page.locator('.add-form');
  await form.getByRole('textbox', { name: 'Label', exact: true }).fill('School office');
  await form.getByRole('combobox', { name: 'Type', exact: true }).selectOption('setting');
  await form.getByRole('textbox', { name: 'Evidence or question' }).fill('The fictional parent visits the school office.');
  await form.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).graph.nodes.some(node => node.label === 'School office')).toBe(true);
  const beforeReread = await readProject(page);

  await notebookSection(page, 'suggestions');
  const refresh = page.locator('.notebook-refresh');
  await refresh.locator('summary').click();
  await refresh.getByRole('button', { name: 'Reread memo', exact: true }).click();
  await expect.poll(() => evaluations).toBe(2);
  await expect(notice).toBeVisible();
  await expect(feedback).toBeVisible();
  await expect.poll(async () => (await readProject(page)).graph).toEqual(beforeReread.graph);
  expect((await readProject(page)).candidates).toEqual(beforeReread.candidates);

  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await notebookSection(page, 'suggestions');
  await expect(notice).toBeVisible();
  await expect(feedback).toBeVisible();
  expect((await readProject(page)).graph).toEqual(beforeReread.graph);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await captureSourceRenderedScreenshot(page, testInfo, 'Feedback-only after reload');
  expect(errors).toEqual([]);
});

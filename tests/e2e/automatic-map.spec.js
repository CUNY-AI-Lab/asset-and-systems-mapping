import { openTools, mapCommand, notebookSection, showMap, projectMenu, preferences } from './support/notebook.js';
import { test, expect, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

const memo = 'A family requests an evaluation from its school. The school refers the student to the Committee on Special Education. A parent attends a community center. The community center coordinates with the school. New York State Education Department decisions affect the school. Public funding affects the school and community center.';

async function readProject(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

test('student automatic flow stays simple, editable, and persistent', async ({ page, makeAxeBuilder }, testInfo) => {
  const violations = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page).toHaveTitle(/Systems Mapping/);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start new project' }).click();
  await expect(page.locator('.project-menu > summary')).toHaveText('Project');
  await expect(page.getByRole('textbox', { name: 'Map title (optional)' })).not.toBeVisible();
  await page.getByRole('textbox', { name: /^Memo/ }).fill(memo);
  await captureSourceRenderedScreenshot(page, testInfo, 'Memo intake');
  await page.getByRole('button', { name: 'Memo review', exact: true }).click();
  // The Studio opens on the map with the Suggestions panel; the memo reading starts in the same click.
  await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Work level' })).toBeVisible();
  expect((await readProject(page)).instructor.requireStudentConfirmation).toBe(false);
  // The first reading stays an explicit student choice; later levels read in the same click that completes the previous one.
  await expect(page.locator('#map-inspector .button:not(.button--ghost):visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Generate guidance' }).click();
  await expect(page.locator('.notebook-refresh > summary')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue →', exact: true })).toBeEnabled();
  await expect(page.locator('.review-details')).not.toHaveAttribute('open', '');
  await expect(page.locator('.memo-drawer')).not.toHaveAttribute('open', '');
  violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Automatic review'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Automatic review');
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  await expect.poll(async () => (await readProject(page)).graph.nodes.length).toBeGreaterThan(0);
  const graph = (await readProject(page)).graph;
  expect(graph.edges.length).toBeGreaterThan(0);
  expect([...graph.nodes, ...graph.edges].every((item) => item.reviewDecision === 'pending' && item.claimState === 'inference')).toBe(true);
  await expect(page.getByRole('button', { name: 'Review issue' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Automatic map'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Automatic map');
  await notebookSection(page, 'review');
  await page.getByRole('button', { name: 'Continue to Meso-level', exact: true }).click();
  // Meso reads the memo and, in automatic mode, commits in the same click.
  await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  await expect.poll(async () => (await readProject(page)).activeScale).toBe('meso');
  await expect.poll(async () => (await readProject(page)).stage).toBe(3);
  await notebookSection(page, 'review');
  await page.getByRole('button', { name: 'Continue to Exo-level', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Micro and Meso' });
  await expect(review).toBeVisible();
  expect((await readProject(page)).activeScale).toBe('meso');
  violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Meso review pause'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Meso review pause');
  await review.getByRole('button', { name: 'Review the map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  const cumulative = (await readProject(page)).graph;
  graph.nodes.forEach(node => expect(cumulative.nodes.some(item => item.id === node.id)).toBe(true));
  await mapCommand(page, 'Full screen map');
  await captureSourceRenderedScreenshot(page, testInfo, 'Full screen automatic map');
  await mapCommand(page, 'Exit full screen');
  await notebookSection(page, 'suggestions');
  await preferences(page);
  await page.getByRole('checkbox', { name: 'Add suggestions automatically' }).uncheck();
  await page.locator('.project-menu > summary').click();
  await expect.poll(async () => (await readProject(page)).instructor.requireStudentConfirmation).toBe(true);
  await captureSourceRenderedScreenshot(page, testInfo, 'Manual review preference');
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  expect((await readProject(page)).graph).toEqual(cumulative);
  expect((await readProject(page)).instructor.requireStudentConfirmation).toBe(true);
  await notebookSection(page, 'review');
  await expect(page.getByRole('complementary', { name: 'Notebook' })).toBeVisible();
  await preferences(page);
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.locator('.project-menu > summary').click();
  violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Automatic map dark'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Automatic map dark');
  assertNoAccessibilityViolations(violations);
  expect(errors).toEqual([]);
});

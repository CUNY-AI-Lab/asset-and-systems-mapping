import { test, expect, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

const memo = 'A family requests an evaluation from its school. The school refers the student to the Committee on Special Education. A parent attends a community center. The community center coordinates with the school. New York State Education Department decisions affect the school. Public funding affects the school and community center.';

async function readProject(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

test('student automatic flow stays simple, editable, and persistent', async ({ page, makeAxeBuilder }, testInfo) => {
  const violations = [];
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start new project' }).click();
  await expect(page.locator('.app-header .header-actions button')).toHaveText(['Projects', 'Map', 'Progress', 'Dark']);
  await expect(page.getByRole('textbox', { name: 'Map title (optional)' })).not.toBeVisible();
  await page.getByRole('textbox', { name: /^Memo/ }).fill(memo);
  await captureSourceRenderedScreenshot(page, testInfo, 'Memo intake');
  await page.getByRole('button', { name: 'Review memo', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Add suggestions automatically' })).toBeChecked();
  await page.getByRole('button', { name: 'Generate guidance' }).click();
  await expect(page.getByRole('button', { name: 'Open map', exact: true })).toBeVisible();
  await expect(page.locator('.review-details')).not.toHaveAttribute('open', '');
  await expect(page.locator('.memo-drawer')).not.toHaveAttribute('open', '');
  violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Automatic review'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Automatic review');
  await page.getByRole('button', { name: 'Open map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  await expect.poll(async () => (await readProject(page)).graph.nodes.length).toBeGreaterThan(0);
  const graph = (await readProject(page)).graph;
  expect(graph.edges.length).toBeGreaterThan(0);
  expect([...graph.nodes, ...graph.edges].every((item) => item.reviewDecision === 'pending' && item.claimState === 'inference')).toBe(true);
  await expect(page.getByRole('button', { name: 'Review issue' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Automatic map'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Automatic map');
  await page.getByRole('button', { name: 'Full screen map' }).click();
  await captureSourceRenderedScreenshot(page, testInfo, 'Full screen automatic map');
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Add suggestions automatically' }).uncheck();
  await expect.poll(async () => (await readProject(page)).instructor.requireStudentConfirmation).toBe(true);
  await captureSourceRenderedScreenshot(page, testInfo, 'Manual review preference');
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  expect((await readProject(page)).graph).toEqual(graph);
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Add suggestions automatically' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Close Progress' }).click();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Automatic map dark'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Automatic map dark');
  assertNoAccessibilityViolations(violations);
});

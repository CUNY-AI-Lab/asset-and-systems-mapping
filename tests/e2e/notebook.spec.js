import { expect, test, scanAccessibility, assertNoAccessibilityViolations, captureSourceRenderedScreenshot } from './support/test.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
import { fieldNotesExcerpt } from '../../shared/field-notes-context.js';

test('map and notebook preserve Field Notes and viewport across every scale and reload', async ({ page, makeAxeBuilder }, testInfo) => {
  test.setTimeout(120_000);
  const errors = [];
  const guidance = [];
  const lessonPrompt = 'Use our library case and this week’s reading.\n\nWhose direct relationships are missing, and what would you observe before naming a Meso linkage?';
  const longNote = ('Which policy applies? 😀 Keep this as a question.\n').repeat(1500).slice(0, 64_000);
  const notes = Object.fromEntries(['micro', 'meso', 'exosphere', 'macrosphere'].map(scale => [
    scale, scale === 'exosphere' ? longNote : `My ${scale} interpretation remains mine.\nAn open question stays open.`,
  ]));
  await page.route('**/api/config/public?**', async route => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ response, json: { ...config, fieldNotesQuestions: { ...config.fieldNotesQuestions, micro: lessonPrompt } } });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/preflight\/evaluations|guidance-jobs|map\/check/.test(request.url())) guidance.push(request.url()); });
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem('notebook-test-seeded')) { localStorage.setItem(key, value); localStorage.setItem('notebook-test-seeded', 'yes'); }
  }, { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const openProject = () => page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  await openProject();
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  const notebook = page.getByRole('complementary', { name: 'Notebook', exact: true });
  for (const level of ['micro', 'meso', 'exosphere', 'macrosphere']) {
    await page.getByRole('combobox', { name: 'Work level' }).selectOption(level);
    await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
    await notebook.getByRole('combobox', { name: 'Notebook section' }).selectOption('review');
    const field = notebook.getByRole('textbox', { name: 'Field notes' });
    await expect(field).toBeVisible();
    if (level === 'micro') {
      await expect(page.locator('.reflection-prompt')).toHaveText(lessonPrompt);
      expect(await page.locator('.reflection-prompt').innerText()).toBe(lessonPrompt);
    }
    expect(await notebook.locator('textarea:visible').count()).toBe(1);
    await expect(notebook.locator('.memo-drawer')).toHaveCount(0);
    await field.fill(notes[level]);
    if (level === 'exosphere') await expect(notebook.getByText(/memo review receives an opening excerpt/)).toBeVisible();
    await nav.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.locator('.graph-canvas')).toBeVisible();
    const camera = await page.locator('.graph-canvas').getAttribute('viewBox');
    await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
    await expect(field).toHaveValue(notes[level]);
    await nav.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.locator('.graph-canvas')).toHaveAttribute('viewBox', camera);
  }
  await page.reload();
  await openProject();
  await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
  await expect(notebook.getByRole('textbox', { name: 'Field notes' })).toHaveValue(notes.macrosphere);
  await notebook.getByText('Notes from other scales', { exact: true }).click();
  for (const scale of ['micro', 'meso', 'exosphere']) {
    await expect(notebook.getByText(notes[scale], { exact: true })).toBeVisible();
  }
  await notebook.getByText('Notes from other scales', { exact: true }).click();
  await notebook.getByRole('combobox', { name: 'Notebook section' }).selectOption('suggestions');
  await notebook.locator('.field-notes-continuity summary').click();
  await expect(notebook.locator('.field-notes-continuity blockquote')).toHaveText(fieldNotesExcerpt('exosphere', longNote).text);
  await expect(notebook.getByText(/Only this opening excerpt accompanies guidance/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('exosphere');
  await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
  await notebook.getByRole('combobox', { name: 'Notebook section' }).selectOption('review');
  await expect(notebook.getByRole('textbox', { name: 'Field notes' })).toHaveValue(longNote);
  await expect(notebook.getByText(/memo review receives an opening excerpt/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('macrosphere');
  await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
  await notebook.getByRole('combobox', { name: 'Notebook section' }).selectOption('review');
  expect(guidance).toEqual([]);
  expect(errors).toEqual([]);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Notebook Field Notes'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Notebook Field Notes');
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Compact map'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Compact map');
});

import { test, expect, captureSourceRenderedScreenshot } from './support/test.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
import { editSelected, notebookSection, showMap } from './support/notebook.js';

async function expectUsableControls(controls, { aligned = false } = {}) {
  const boxes = await controls.evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height, viewportWidth: window.innerWidth };
  }));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(box.viewportWidth);
    if (aligned) expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
  }
}

test('workspace and map editing controls stay aligned and usable', async ({ page }, testInfo) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await expectUsableControls(nav.getByRole('button', { name: /^(Map|Notebook)$/ }), { aligned: true });

  await showMap(page);
  const resident = page.locator('[data-graph-id="node_e2e_resident"]');
  await resident.click();
  await editSelected(page);
  const moveButtons = page.getByRole('button', { name: /^Move Resident (left|right|up|down)$/ });
  await expect(moveButtons).toHaveCount(4);
  await expectUsableControls(moveButtons, { aligned: true });
  await expectUsableControls(page.getByRole('button', { name: /^(Done|Connect from Resident|Delete|Save note)$/ }));
  await captureSourceRenderedScreenshot(page, testInfo, 'Map item editing controls');
  const before = await resident.getAttribute('transform');
  await page.getByRole('button', { name: 'Move Resident left', exact: true }).click();
  await expect(resident).not.toHaveAttribute('transform', before);

  await notebookSection(page, 'review');
  const notebook = page.getByRole('complementary', { name: 'Notebook', exact: true });
  await expectUsableControls(notebook.getByRole('button', { name: /^(Save note|Complete Macro-level)$/ }));
  const field = notebook.getByRole('textbox', { name: 'Field notes' });
  await field.fill('A question to revisit.');
  await showMap(page);
  await notebookSection(page, 'review');
  await expect(field).toHaveValue('A question to revisit.');
  await captureSourceRenderedScreenshot(page, testInfo, 'Field Notes controls');
});

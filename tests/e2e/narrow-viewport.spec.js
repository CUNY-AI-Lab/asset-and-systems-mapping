import { expect, test, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { showMap, editSelected } from './support/notebook.js';
import { buildEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { serializeProject } from '../../src/domain.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

// Students mostly open the map on a phone. Nothing may be cut off, no control
// may leave the viewport, and the selection guide stays one line.
test.use({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true });
// The overrides make both Playwright projects identical here; run it once.
test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== 'chromium-phone', 'phone project only'); });

async function openProject(page) {
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('narrow-fixture-loaded')) return;
    localStorage.setItem(key, value);
    sessionStorage.setItem('narrow-fixture-loaded', 'yes');
  }, { key: STORAGE_KEY, value: serializeProject(buildEastHarlemDisabilityProject()) });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

// Every visible control sits inside the viewport and keeps a usable size.
async function controlIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    for (const control of document.querySelectorAll('button, select, input:not([type=checkbox]), textarea, a[href]')) {
      const style = getComputedStyle(control);
      if (style.display === 'none' || style.visibility === 'hidden' || control.closest('[hidden], [aria-hidden="true"]')) continue;
      // Content of a closed disclosure keeps a layout box in Chromium but is not shown.
      if (control.closest('details:not([open])') && !control.closest('summary')) continue;
      const bounds = control.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const name = (control.getAttribute('aria-label') || control.textContent || control.name || control.tagName).trim().slice(0, 40);
      if (bounds.left < -1 || bounds.right > window.innerWidth + 1) issues.push(`${name} leaves the viewport (${Math.round(bounds.left)}..${Math.round(bounds.right)})`);
      if (control.tagName === 'BUTTON' && bounds.height < 24) issues.push(`${name} is only ${Math.round(bounds.height)}px tall`);
      if (control.scrollWidth > control.clientWidth + 2 && control.tagName === 'BUTTON') issues.push(`${name} clips its text`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) issues.push('page scrolls horizontally');
    return issues;
  });
}

test('the workspace fits a 320px phone with every control reachable', async ({ page, makeAxeBuilder }, testInfo) => {
  await openProject(page);
  await showMap(page);
  expect(await controlIssues(page)).toEqual([]);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Narrow map'));

  // Selecting a node shows a one-line guide and the editor with stacked fields.
  await page.getByRole('button', { name: /^Resident,/ }).click();
  const guide = page.locator('.map-reading-guide');
  if (await guide.isVisible()) {
    const box = await guide.boundingBox();
    expect(box.height, 'selection guide stays one line').toBeLessThan(56);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await editSelected(page);
  const inspector = page.locator('#map-inspector');
  await expect(inspector.getByRole('textbox', { name: 'Label' })).toBeVisible();
  // Paired fields (System and Type) stack at this width instead of clipping their text.
  for (const select of await inspector.locator('.field-pair select').all()) {
    if (!await select.isVisible()) continue;
    const box = await select.boundingBox();
    expect(box.width, 'paired selects are not squeezed into half columns').toBeGreaterThan(200);
  }
  expect(await controlIssues(page)).toEqual([]);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Narrow node editor'));
});

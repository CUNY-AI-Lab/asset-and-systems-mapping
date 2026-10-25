// Memo upload path: the synthetic East Harlem memo as a Word file, as its PDF export
// (LibreOffice; Word autocorrect turned one apostrophe curly), and an image-only PDF.
import { test, expect } from './support/test.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('./fixtures/memo-uploads/', import.meta.url));
const readProject = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);

async function startProject(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start new project' }).click();
}

for (const file of ['east-harlem-memo.docx', 'east-harlem-memo.pdf']) {
  test(`upload ${file}, generate guidance, reach a map`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await startProject(page);
    await page.locator('.upload-zone input[type=file]').setInputFiles(here + file);
    await expect(page.locator('p.privacy-note[role=status]')).toContainText(/text imported/i);
    const memoBox = page.getByRole('textbox', { name: /^Memo/ });
    await expect(memoBox).toHaveValue(/East Harlem resident/);
    await expect(memoBox).toHaveValue(/attendant’s available hours/); // Word autocorrect kept the curly apostrophe
    await page.getByRole('button', { name: 'Memo review', exact: true }).click();
    await page.getByRole('button', { name: 'Generate guidance' }).click();
    await expect(page.getByRole('button', { name: 'Continue →', exact: true })).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.locator('.review-details > summary').click();
    const guidanceItems = await page.locator('.review-details .studio-feedback').count();
    expect(guidanceItems).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Continue →', exact: true }).click();
    await expect.poll(async () => (await readProject(page)).graph.nodes.length).toBeGreaterThan(0);
    const project = await readProject(page);
    const review = project.preflight?.memoReview;
    expect(errors).toEqual([]);
  });
}

test('an image-only PDF explains itself and leaves the memo field alone', async ({ page }) => {
  await startProject(page);
  await page.locator('.upload-zone input[type=file]').setInputFiles(here + 'image-only.pdf');
  await expect(page.locator('p.privacy-note[role=status]')).toContainText('No text could be read from this PDF');
  await expect(page.getByRole('textbox', { name: /^Memo/ })).toHaveValue('');
  await expect(page.locator('.upload-zone strong')).toHaveText('Upload a memo');
});

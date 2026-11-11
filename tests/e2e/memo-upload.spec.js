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

test('a multi-page PDF preserves inline citations and references through review and reload', async ({ page }) => {
  await startProject(page);
  await page.locator('.upload-zone input[type=file]').setInputFiles(here + 'multi-page-citations.pdf');
  await expect(page.locator('p.privacy-note[role=status]')).toContainText('PDF text imported from 3 pages.');
  const memo = page.getByRole('textbox', { name: /^Memo/ });
  await expect(memo).toHaveValue(/Rosa meets the teacher at the school \(Smith, 2025, p\. 12\)\./);
  await expect(memo).toHaveValue(/coordinates with the center \(Lee, 2024\)\./);
  await expect(memo).toHaveValue(/References[\s\S]*Smith, A\.[\s\S]*Lee, B\./);
  const imported = await memo.inputValue();
  await page.getByRole('button', { name: 'Memo review', exact: true }).click();
  await page.getByRole('button', { name: 'Generate guidance' }).click();
  await expect(page.getByRole('button', { name: 'Continue →', exact: true })).toBeEnabled({ timeout: 30_000 });
  await expect.poll(async () => (await readProject(page)).submission.text).toBe(imported);
  await page.reload();
  await expect.poll(async () => (await readProject(page)).submission.text).toBe(imported);
});

test('the import status stays clear of the upload zone focus ring', async ({ page }) => {
  await startProject(page);
  const input = page.locator('.upload-zone input[type=file]');
  await input.setInputFiles(here + 'multi-page-citations.pdf');
  const status = page.locator('p.privacy-note[role=status]');
  await expect(status).toContainText('PDF text imported');
  await input.focus();
  // Both edges are read in one pass so scrolling cannot separate them.
  const clearance = await status.evaluate(note => {
    const zone = note.parentElement.querySelector('.upload-zone');
    const style = getComputedStyle(zone);
    const ring = zone.getBoundingClientRect().bottom + parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    return note.getBoundingClientRect().top - ring;
  });
  expect(clearance).toBeGreaterThanOrEqual(0);
});

test('a PDF with an empty text layer on one page explains the missing passage', async ({ page }) => {
  await startProject(page);
  await page.locator('.upload-zone input[type=file]').setInputFiles(here + 'mixed-text-pages.pdf');
  await expect(page.locator('p.privacy-note[role=status]')).toContainText('1 page');
  await expect(page.locator('p.privacy-note[role=status]')).toContainText('selectable text');
  await expect(page.getByRole('textbox', { name: /^Memo/ })).toHaveValue(/Rosa meets the teacher/);
});

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

test('a delayed PDF import preserves a newer memo edit', async ({ page }) => {
  await page.addInitScript(() => {
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function (...args) {
      window.memoWorkersFinished = (window.memoWorkersFinished || 0) + 1;
      return terminate.apply(this, args);
    };
  });
  await startProject(page);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/pdfMemo-*.js', async route => {
    entered();
    await pending;
    await route.continue();
  });
  await page.locator('.upload-zone input[type=file]').setInputFiles(here + 'east-harlem-memo.pdf');
  await started;
  const memo = page.getByRole('textbox', { name: /^Memo/ });
  const edited = 'Synthetic memo edited while the PDF reader was loading.';
  await memo.fill(edited);
  release();
  // The loading task releases its worker in finally. Wait for actual parsing
  // completion, not a guessed delay, before checking the stale-result guard.
  await expect.poll(() => page.evaluate(() => window.memoWorkersFinished || 0)).toBe(1);
  await expect(memo).toHaveValue(edited);
  await expect(page.locator('p.privacy-note[role=status]').filter({ hasText: 'PDF text imported.' })).toHaveCount(0);
  await expect.poll(async () => (await readProject(page)).submission.text).toBe(edited);
  expect((await readProject(page)).events.some(event => event.action === 'memo.imported')).toBe(false);
});

test('an unreadable PDF preserves the existing memo and file metadata', async ({ page }) => {
  await startProject(page);
  const upload = page.locator('.upload-zone input[type=file]');
  await upload.setInputFiles(here + 'east-harlem-memo.docx');
  await expect(page.locator('p.privacy-note[role=status]')).toHaveText('DOCX text imported.');
  await expect.poll(async () => (await readProject(page)).submission.fileName).toBe('east-harlem-memo.docx');
  const previous = (await readProject(page)).submission;
  await upload.setInputFiles(here + 'image-only.pdf');
  await expect(page.locator('p.privacy-note[role=status]')).toContainText('No text could be read from this PDF');
  await expect(page.getByRole('textbox', { name: /^Memo/ })).toHaveValue(previous.text);
  expect((await readProject(page)).submission).toEqual(previous);
});

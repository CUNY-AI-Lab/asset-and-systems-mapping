// @vitest-environment node
import { beforeAll, afterAll, test, expect } from 'vitest';
import { createTestHarness } from 'wrangler';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
let harness, url;
beforeAll(async () => {
  harness = createTestHarness({ workers: [{ config: {
    name: 'mapping-bug-report-test', main: 'cloudflare/test-bug-report-worker.ts',
    compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    assets: { directory: './dist-cloudflare', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'single-page-application' },
    vars: { PUBLIC_ORIGIN: 'https://systems.test', LOGIN_URL: '/auth/start', RELEASE: 'bug-report-fixture' },
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '884477', simple: { limit: 1000, period: 60 } }],
  } }] });
  ({ url } = await harness.listen());
}, 30000);
afterAll(async () => { await harness?.close(); });
const control = (mode, signedIn = false) => harness.fetch('/__bug-fixture', { method: 'POST', body: JSON.stringify({ mode, signedIn }) });
const stats = async () => (await (await harness.fetch('/__bug-fixture')).json()).calls;
const sample = { reportId: '11111111-1111-4111-8111-111111111111', name: 'Fixture Reporter', email: 'reporter@example.edu', description: 'The map could not be saved after opening my project.' };
test('production route allows signed-out reports, secures origin, and returns no-store', async () => {
  await control('accepted');
  const request = headers => harness.getWorker('mapping-bug-report-test').fetch(new URL('/api/bug-reports', url), { method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(sample) });
  const response = await request();
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.json()).toEqual({ ok: true, status: 'accepted', reportId: sample.reportId });
  expect((await request({ origin: 'https://foreign.example' })).status).toBe(403);
  expect((await request({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect(await stats()).toHaveLength(1);
});

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('footer supports keyboard, safe retry and uncertain receipt on desktop and phone', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport }); const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await control('accepted'); await page.goto(url.href);
        await browserExpect(page.getByRole('link', { name: 'CUNY Login', exact: true })).toBeVisible();
        const summary = page.locator('.bug-report > summary');
        await browserExpect(summary).toBeVisible(); await summary.focus(); await summary.press('Enter');
        await page.getByLabel('Name', { exact: true }).fill(sample.name);
        await page.getByLabel('Email', { exact: true }).fill(sample.email);
        await page.getByLabel('Description of the bug').fill(sample.description);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const borders = await page.locator('.bug-report-footer').evaluate(el => { const css = getComputedStyle(el); return [css.borderTopWidth, css.borderBottomWidth]; });
        expect(borders).toEqual(['1px', '1px']);
        const footer = await page.locator('.bug-report-footer').boundingBox(); expect(Math.abs(footer.y + footer.height - viewport.height)).toBeLessThan(2);
        await control('unavailable'); const sent = [];
        page.on('request', request => { if (request.url().endsWith('/api/bug-reports')) sent.push(request.postDataJSON()); });
        await page.getByRole('button', { name: 'Send bug report' }).click();
        await browserExpect(page.locator('.bug-report__status')).toContainText('description is still here');
        await browserExpect(page.getByLabel('Name', { exact: true })).toBeEnabled();
        await browserExpect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
        await control('accepted'); await page.getByRole('button', { name: 'Try again' }).click();
        await browserExpect(page.locator('.bug-report__status')).toContainText('accepted for delivery');
        expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
        await page.reload(); await control('unknown'); await page.locator('.bug-report > summary').click();
        await page.getByLabel('Name', { exact: true }).fill(sample.name); await page.getByLabel('Email', { exact: true }).fill(sample.email);
        await page.getByLabel('Description of the bug').fill(sample.description);
        await page.getByRole('button', { name: 'Send bug report' }).click();
        await browserExpect(page.getByLabel('Description of the bug')).toBeDisabled();
        await page.getByRole('button', { name: 'Check report status' }).click();
        await browserExpect(page.getByRole('button', { name: 'Check report status' })).toBeInViewport({ ratio: 1 });
        const calls = await stats(); expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
        if (process.env.BUG_REPORT_SCREENSHOTS) {
          await mkdir(process.env.BUG_REPORT_SCREENSHOTS, { recursive: true });
          await page.screenshot({ path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-uncertain.png` });
        }
        await page.locator('.bug-report > summary').click(); await browserExpect(page.getByRole('form', { name: 'Report a bug' })).toBeHidden();
        // Preserve the existing workspace navigation when the footer unfolds.
        await control('accepted', true); await page.reload();
        await page.getByRole('button', { name: 'New project', exact: true }).click();
        await browserExpect(page.locator('.app-footer')).toBeVisible();
        await page.locator('.bug-report > summary').click();
        await browserExpect.poll(() => page.evaluate(() => {
          const nav = document.querySelector('.app-footer').getBoundingClientRect();
          const support = document.querySelector('.bug-report-footer').getBoundingClientRect();
          return nav.bottom <= support.top + 2;
        })).toBe(true);
        const nav = await page.locator('.app-footer').boundingBox();
        expect(nav.y).toBeGreaterThan(0);
        if (process.env.BUG_REPORT_SCREENSHOTS) await page.screenshot({ path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-workspace.png` });
        expect(errors).toEqual([]);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}, 60000);

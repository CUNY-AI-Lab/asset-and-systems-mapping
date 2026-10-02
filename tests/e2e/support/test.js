import AxeBuilder from '@axe-core/playwright';
import { expect, test as base } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

export const test = base.extend({
  makeAxeBuilder: async ({ page }, use) => {
    await use(() => new AxeBuilder({ page }).withTags(WCAG_TAGS));
  },
});

export { expect };

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function gitOutput(args, encoding = 'utf8') {
  try {
    return execFileSync('git', args, { cwd: process.cwd(), encoding, maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return encoding === 'buffer' ? Buffer.alloc(0) : '[unavailable]';
  }
}

function directoryFingerprint(root) {
  const digest = createHash('sha256');
  const visit = (directory) => readdirSync(directory, { withFileTypes: true })
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        digest.update(relative(root, path));
        digest.update('\0');
        digest.update(readFileSync(path));
        digest.update('\0');
      }
    });
  try {
    if (statSync(root).isDirectory()) visit(root);
    else return '[unavailable]';
  } catch {
    return '[unavailable]';
  }
  return digest.digest('hex');
}

export async function scanAccessibility(page, makeAxeBuilder, testInfo, state) {
  // axe evaluates computed colors at the instant of analysis. Wait for finite
  // entrance and disclosure animations so a transient opacity frame is not
  // mistaken for the settled interface's contrast.
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter((animation) => (
      (animation.playState === 'running' || animation.pending)
      && animation.effect?.getTiming?.().iterations !== Infinity
    ));
    // A paused/replaced transition must not hang the accessibility audit.
    let timeout;
    await Promise.race([
      Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => { timeout = setTimeout(resolve, 2000); }),
    ]);
    clearTimeout(timeout);
  });
  const results = await makeAxeBuilder().analyze();
  const name = `${slug(state)}-axe.json`;
  const outputPath = testInfo.outputPath(name);
  await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
  await testInfo.attach(`${state} axe results`, { path: outputPath, contentType: 'application/json' });
  return results.violations.map((violation) => ({
    state,
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })),
  }));
}

export async function captureSourceRenderedScreenshot(page, testInfo, state) {
  // Capture the settled screen after real transient notifications expire.
  // Never hide, crop, or replace UI to manufacture a cleaner result.
  await expect(page.locator('.toast.is-visible')).toHaveCount(0, { timeout: 6500 });
  const basename = slug(state);
  const screenshotPath = testInfo.outputPath(`${basename}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
  const screenshot = readFileSync(screenshotPath);
  const gitStatus = gitOutput(['status', '--short']).trim();
  const patch = gitOutput(['diff', '--binary', 'HEAD'], 'buffer');
  const metadata = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourceKind: 'local-built-bundle',
    sourceCommit: gitOutput(['rev-parse', 'HEAD']).trim(),
    sourceDirty: Boolean(gitStatus),
    sourceStatus: gitStatus,
    sourceDiffSha256: sha256(patch),
    distSha256: directoryFingerprint(resolve(process.cwd(), 'dist')),
    sourceTreesSha256: Object.fromEntries(['src', 'shared', 'public'].map(name => [name, directoryFingerprint(resolve(process.cwd(), name))])),
    lockfileSha256: sha256(readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'))),
    pageUrl: page.url(),
    testTitle: testInfo.titlePath.join(' > '),
    project: testInfo.project.name,
    browserName: testInfo.project.use.browserName || 'chromium',
    browserVersion: page.context().browser()?.version() || '[unavailable]',
    viewport: page.viewportSize(),
    captureMethod: 'Playwright page.screenshot',
    mimeType: 'image/png',
    screenshotSha256: sha256(screenshot),
    generated: false,
  };
  const metadataPath = testInfo.outputPath(`${basename}.provenance.json`);
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await testInfo.attach(`${state} source-rendered screenshot`, { path: screenshotPath, contentType: 'image/png' });
  await testInfo.attach(`${state} screenshot provenance`, { path: metadataPath, contentType: 'application/json' });
}

export function assertNoAccessibilityViolations(violations) {
  expect(violations, `Automatically detectable WCAG A/AA violations:\n${JSON.stringify(violations, null, 2)}`).toEqual([]);
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../pages/index.html', import.meta.url), 'utf8');
const destination = 'https://systems-mapping.ailab-452.workers.dev/';
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('Pages navigation discards incoming paths, query strings and fragments', () => {
  for (const incoming of [
    'https://cuny-ai-lab.github.io/systems-mapping/',
    'https://cuny-ai-lab.github.io/systems-mapping/?token=fabricated&code=fabricated#access_token=fabricated',
    'https://cuny-ai-lab.github.io/systems-mapping/?redirect=https://example.com/#project/fabricated',
  ]) {
    const location = new URL(incoming);
    const navigations = [];
    location.replace = url => navigations.push(url);
    vm.runInNewContext(script, { window: { location } });
    assert.deepEqual(navigations, [destination]);
  }
});

test('Static fallback is accessible without JavaScript and suppresses referrers', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main>/);
  assert.match(html, /<h1>Systems Mapping has moved<\/h1>/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.ok(html.includes(`<a href="${destination}" rel="noreferrer">Open Systems Mapping</a>`));
  assert.doesNotMatch(html, /http-equiv="refresh"/i);
});

import { afterEach, expect, test, vi } from 'vitest';
import { appMount, appPath, appPathname } from './appPath.js';
import { institutionalLoginUrl } from './accountStorage.js';
import { courseWorkspacePath, instructorWorkspacePath } from './courseContext.js';

afterEach(() => vi.unstubAllGlobals());
const visit = path => vi.stubGlobal('window', { location: new URL(path, 'https://tools.ailab.gc.cuny.edu') });

test.each([
  ['https://systems-mapping.ailab-452.workers.dev/', '', '/api/cloud/projects'],
  ['https://systems-mapping-dev.ailab-452.workers.dev/p/project', '', '/api/cloud/projects'],
  ['https://tools.ailab.gc.cuny.edu/systems-mapping', '/systems-mapping', '/systems-mapping/api/cloud/projects'],
  ['https://tools.ailab.gc.cuny.edu/systems-mapping/p/project', '/systems-mapping', '/systems-mapping/api/cloud/projects'],
  ['https://tools.ailab.gc.cuny.edu/systems-mapping-other', '', '/api/cloud/projects'],
])('resolves app paths at %s', (url, mount, apiPath) => {
  const location = new URL(url);
  expect(appMount(location)).toBe(mount);
  expect(appPath('/api/cloud/projects', location)).toBe(apiPath);
});

test('mounted course and shared-project navigation preserve their path and selection', () => {
  visit('/systems-mapping/p/abcdefghijklmnopqrst?course=seminar');
  const course = { kind: 'course', id: 'seminar' };
  expect(appPathname()).toBe('/p/abcdefghijklmnopqrst');
  expect(courseWorkspacePath('/p/abcdefghijklmnopqrst', course)).toBe('/systems-mapping/p/abcdefghijklmnopqrst?course=seminar');
  expect(institutionalLoginUrl(course)).toBe('/systems-mapping/auth/login?returnTo=%2Fsystems-mapping%2Fp%2Fabcdefghijklmnopqrst%3Fcourse%3Dseminar');
  expect(instructorWorkspacePath(course)).toBe('/systems-mapping/?course=seminar&view=instructor');
});

test('mounted instructor sign-in returns to the course console', () => {
  visit('/systems-mapping/?course=seminar&view=instructor');
  expect(institutionalLoginUrl({ kind: 'course', id: 'seminar' })).toBe('/systems-mapping/auth/login?returnTo=%2Fsystems-mapping%2F%3Fcourse%3Dseminar%26view%3Dinstructor');
});

test('explicit mounted landing sign-in preserves the full page query and hash', () => {
  visit('/systems-mapping/?course=seminar&view=instructor&context=teaching#details');
  const login = new URL(institutionalLoginUrl({ kind: 'course', id: 'seminar' }, { landing: true }), window.location.origin);
  expect(login.pathname).toBe('/systems-mapping/auth/login');
  expect(login.searchParams.get('returnTo')).toBe('/systems-mapping/?course=seminar&view=instructor&context=teaching#details');
});

test('session recovery keeps its established course even when the page query changes', () => {
  visit('/systems-mapping/?course=another-course&context=teaching');
  const login = new URL(institutionalLoginUrl({ kind: 'course', id: 'seminar' }), window.location.origin);
  expect(login.searchParams.get('returnTo')).toBe('/systems-mapping/?course=seminar');
});

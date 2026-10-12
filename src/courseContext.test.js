import { afterEach, describe, expect, it, vi } from 'vitest';
import { courseRequestHeaders, courseWorkspacePath, initialApiCourseSelection, parseCourseSelection } from './courseContext.js';
import { institutionalLoginUrl, releaseAccountStorage, useAccountStorage } from './accountStorage.js';

afterEach(() => {
  releaseAccountStorage();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
});

describe('course selection', () => {
  it.each(['a', 'course-2026', 'a'.repeat(64)])('accepts the strict course slug %s', id => {
    expect(parseCourseSelection(`?course=${id}`)).toEqual({ kind: 'course', id });
    expect(courseRequestHeaders(parseCourseSelection(`?course=${id}`))).toEqual({ 'x-systems-course': id });
  });

  it.each(['?course=', '?course=search', '?course=UPPER', '?course=-course', '?course=course-', '?course=one%2Ftwo', '?course=a%0A', `?course=${'a'.repeat(65)}`, '?course=a&course=a', '?course=a&course=b'])('fails closed for %s', search => {
    const selection = parseCourseSelection(search);
    expect(selection.kind).toBe('invalid');
    expect(() => courseRequestHeaders(selection)).toThrow();
    expect(() => courseWorkspacePath('/', selection)).toThrow();
  });

  it('preserves general behavior when no course is selected', () => {
    expect(courseRequestHeaders(parseCourseSelection('?unrelated=yes'))).toEqual({});
    expect(courseWorkspacePath('/p/token')).toBe('/p/token');
    expect(institutionalLoginUrl()).toBe('/auth/start');
  });

  it('only reads a URL course before account bootstrap in the Cloudflare build', () => {
    window.history.replaceState(null, '', '/?course=course-a');
    vi.stubEnv('VITE_ACCOUNT_WORKSPACE', 'false');
    expect(initialApiCourseSelection().kind).toBe('general');
    vi.stubEnv('VITE_ACCOUNT_WORKSPACE', 'true');
    expect(initialApiCourseSelection()).toEqual({ kind: 'course', id: 'course-a' });
  });

  it('keeps login destinations and dashboard navigation in the selected course', () => {
    const selection = parseCourseSelection('?course=course-a');
    expect(courseWorkspacePath('/', selection)).toBe('/?course=course-a');
    expect(new URL(institutionalLoginUrl(selection), window.location.origin).searchParams.get('returnTo')).toBe('/?course=course-a');
    window.history.replaceState(null, '', '/p/abcdefghijklmnopqrst?course=course-a');
    expect(new URL(institutionalLoginUrl(selection), window.location.origin).searchParams.get('returnTo')).toBe('/p/abcdefghijklmnopqrst?course=course-a');
  });

  it('keeps server-issued caches and selections isolated across courses and the general workspace', () => {
    const a = useAccountStorage('server-cache-a', null, parseCourseSelection('?course=course-a'));
    a.setItem('draft', 'course A draft');
    const b = useAccountStorage('server-cache-b', null, parseCourseSelection('?course=course-b'));
    const general = useAccountStorage('server-cache-general', null);
    expect(b.getItem('draft')).toBeNull();
    expect(general.getItem('draft')).toBeNull();
    expect(a.getItem('draft')).toBe('course A draft');
    expect(a.courseSelection.id).toBe('course-a');
    expect(Object.isFrozen(a.courseSelection)).toBe(true);
  });
});

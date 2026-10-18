const GENERAL = Object.freeze({ kind: 'general', id: null });
const INVALID = Object.freeze({ kind: 'invalid', id: null });
const COURSE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

// The URL selects a workspace; only the server can establish access to it.
// Keep invalid selections distinct from the general workspace.
export function parseCourseSelection(search = '') {
  const values = new URLSearchParams(search).getAll('course');
  if (!values.length) return GENERAL;
  if (values.length !== 1 || !COURSE_ID.test(values[0]) || values[0] === 'search') return INVALID;
  return Object.freeze({ kind: 'course', id: values[0] });
}

export function courseSelectionError() {
  return Object.assign(new Error('Invalid course selection'), {
    status: 403,
    payload: { details: { code: 'course_invalid' } },
  });
}

export function courseRequestHeaders(selection = GENERAL) {
  if (selection.kind === 'invalid') throw courseSelectionError();
  return selection.kind === 'course' ? { 'x-systems-course': selection.id } : {};
}

export function courseWorkspacePath(path = '/', selection = GENERAL) {
  if (selection?.kind === 'invalid') throw courseSelectionError();
  return selection?.kind === 'course' ? `${path}?course=${encodeURIComponent(selection.id)}` : path;
}

export function initialApiCourseSelection() {
  // The separately deployed Node application must not acquire course behavior
  // just because someone adds a query parameter to a public link.
  return import.meta.env.VITE_ACCOUNT_WORKSPACE === 'true'
    ? parseCourseSelection(window.location.search)
    : GENERAL;
}

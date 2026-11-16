export function cleanLegacyBrowserRecoveryQuery(location = window.location, history = window.history) {
  const params = new URLSearchParams(location.search);
  if (!params.has('browserRecovery')) return false;
  params.delete('browserRecovery');
  const query = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  return true;
}

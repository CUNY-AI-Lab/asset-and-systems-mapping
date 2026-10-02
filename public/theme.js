// Run before styles load without requiring an inline-script CSP exception.
try {
  if (localStorage.getItem('systems-mapping.theme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#171717');
  }
} catch (_) { /* The application offers recovery if browser storage is unavailable. */ }

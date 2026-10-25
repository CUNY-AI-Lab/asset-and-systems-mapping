import { useEffect, useRef, useState } from 'react';
import { mountBugReport } from './form.js';
import './form.css';
import './mapping.css';
import { mountBugReport as mountContactReport } from './contact-form.js';

export default function BugReport() {
  const footer = useRef(null);
  const [mode, setMode] = useState(null);
  const enabled = mode !== null;
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch('/api/bug-reports/availability', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(async value => {
        if (value?.mode === 'contact') await import('./contact-form.css');
        if (!controller.signal.aborted) setMode(value?.enabled === true ? value.mode || 'email' : null);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const mount = mode === 'contact' ? mountContactReport : mountBugReport;
    const report = mount(footer.current, { loginUrl: '/auth/start', loginClassName: 'button studio-action button--primary account-login', path: () => {
      const path = window.location.pathname;
      if (/^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(path)) return '/p/:shared-map';
      return '/';
    } });
    root.classList.add('has-bug-report');
    const resize = new ResizeObserver(([entry]) => {
      root.style.setProperty('--bug-report-height', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
    });
    resize.observe(footer.current);
    return () => {
      resize.disconnect(); report(); root.classList.remove('has-bug-report'); root.style.removeProperty('--bug-report-height');
    };
  }, [mode]);
  return enabled ? <footer ref={footer} className={`bug-report-footer${mode === 'contact' ? ' bug-report-footer--contact' : ''}`} aria-label="Bug reports" /> : null;
}

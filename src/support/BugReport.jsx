import { useEffect, useRef, useState } from 'react';
import { mountBugReport } from './form.js';
import './form.css';
import './mapping.css';

export default function BugReport() {
  const footer = useRef(null);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch('/api/bug-reports/availability', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (!controller.signal.aborted) setEnabled(value?.enabled === true); })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const unmount = mountBugReport(footer.current, { path: () => {
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
      resize.disconnect(); unmount(); root.classList.remove('has-bug-report'); root.style.removeProperty('--bug-report-height');
    };
  }, [enabled]);
  return enabled ? <footer ref={footer} className="bug-report-footer" aria-label="Bug reports" /> : null;
}

import { useEffect, useRef, useState } from 'react';
import { mountBugReport } from './form.js';
import './form.css';
import './mapping.css';

function reportPath() {
  if (/^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(window.location.pathname)) return '/p/:shared-map';
  if (document.querySelector('.teacher-main')) return '/teacher.html';
  if (document.querySelector('.studio-dashboard')) return '/account.html';
  return '/';
}

export default function BugReportWidget() {
  const host = useRef(null);
  const [runtime, setRuntime] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch('/api/cloud/runtime', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (!controller.signal.aborted && value?.bugReportEnabled === true) setRuntime(value); })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);

  useEffect(() => {
    if (!runtime || !host.current) return;
    const root = document.documentElement;
    const dispose = mountBugReport(host.current, {
      loginUrl: runtime.loginUrl || '/auth/start',
      path: reportPath,
    });
    root.classList.add('has-bug-report');
    const resize = new ResizeObserver(([entry]) => {
      root.style.setProperty('--bug-report-height', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
    });
    resize.observe(host.current);
    return () => {
      resize.disconnect(); dispose();
      root.classList.remove('has-bug-report'); root.style.removeProperty('--bug-report-height');
    };
  }, [runtime]);

  return runtime ? <footer className="bug-report-footer" aria-label="Bug reports" ref={host} /> : null;
}

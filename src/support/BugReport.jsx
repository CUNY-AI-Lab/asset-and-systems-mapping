import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mountBugReport } from './form.js';
import { useBugReportDockTarget } from './BugReportDock.jsx';
import './form.css';
import './mapping.css';
import { mountBugReport as mountContactReport } from './contact-form.js';

export default function BugReport() {
  const footer = useRef(null);
  const [host] = useState(() => document.createElement('div'));
  const dock = useBugReportDockTarget();
  const [mode, setMode] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const enabled = mode !== null;
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch('/api/bug-reports/availability', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(async value => {
        if (value?.mode === 'contact') await import('./contact-form.css');
        if (!controller.signal.aborted) {
          setDelivery(value?.delivery || null);
          setMode(value?.enabled === true ? value.mode || 'email' : null);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const target = dock || footer.current;
    const panel = host.querySelector('.bug-report__panel');
    const wasOpen = panel && !panel.hidden;
    const focused = host.contains(document.activeElement) ? document.activeElement : null;
    host.className = `bug-report-host${dock ? ' bug-report-host--docked' : ''}`;
    if (target && host.parentNode !== target) {
      // Moving the existing host preserves the form's draft, report reference,
      // pending request and listeners. A portal target change would remount it.
      if (host.isConnected && target.isConnected && typeof target.moveBefore === 'function') target.moveBefore(host, null);
      else target.append(host);
      if (wasOpen && typeof panel.showPopover === 'function' && !panel.matches(':popover-open')) panel.showPopover();
      focused?.focus({ preventScroll: true });
    }
    root.classList.add('has-bug-report');
    root.classList.toggle('bug-report-docked', Boolean(dock));
    const measure = () => root.style.setProperty('--bug-report-height', `${dock ? 0 : Math.ceil(footer.current?.getBoundingClientRect().height || 0)}px`);
    const resize = new ResizeObserver(measure);
    if (footer.current) resize.observe(footer.current);
    measure();
    window.dispatchEvent(new Event('resize'));
    return () => {
      resize.disconnect();
      root.classList.remove('has-bug-report', 'bug-report-docked');
      root.style.removeProperty('--bug-report-height');
    };
  }, [enabled, dock, host]);
  useEffect(() => () => host.remove(), [host]);
  useEffect(() => {
    if (!enabled) return;
    const mount = mode === 'contact' ? mountContactReport : mountBugReport;
    const report = mount(host, { delivery, loginUrl: '/auth/start', loginClassName: 'button studio-action button--primary account-login', path: () => {
      const path = window.location.pathname;
      if (/^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(path)) return '/p/:shared-map';
      return '/';
    } });
    return report;
  }, [mode, delivery, host]);
  return enabled ? <footer ref={footer} hidden={Boolean(dock)} className={`bug-report-footer${mode === 'contact' ? ' bug-report-footer--contact' : ''}`} aria-label="Bug reports" /> : null;
}

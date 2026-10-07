import { useEffect, useRef } from 'react';
import { mountBugReport } from './form.js';
import './form.css';
import './mapping.css';

export default function BugReport() {
  const footer = useRef(null);
  useEffect(() => {
    const root = document.documentElement;
    const unmount = mountBugReport(footer.current);
    root.classList.add('has-bug-report');
    const resize = new ResizeObserver(([entry]) => {
      root.style.setProperty('--bug-report-height', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
    });
    resize.observe(footer.current);
    return () => {
      resize.disconnect(); unmount(); root.classList.remove('has-bug-report'); root.style.removeProperty('--bug-report-height');
    };
  }, []);
  return <footer ref={footer} className="bug-report-footer" aria-label="Bug reports" />;
}

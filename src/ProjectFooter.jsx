import { useLayoutEffect, useRef } from 'react';

// The course workspace's guide on the Lab website. The separate Node interface
// predates it, so only the account workspace build links there.
export const GUIDE_URL = 'https://ailab.gc.cuny.edu/docs/systems-mapping/';

export default function ProjectFooter({ children }) {
  const footer = useRef(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--project-footer-height', `${Math.ceil(footer.current?.getBoundingClientRect().height || 0)}px`);
    root.classList.add('has-project-footer');
    const resize = new ResizeObserver(measure);
    resize.observe(footer.current, { box: 'border-box' });
    measure();
    return () => {
      resize.disconnect();
      root.classList.remove('has-project-footer');
      root.style.removeProperty('--project-footer-height');
    };
  }, []);
  return <footer ref={footer} className="project-footer" aria-label="Project credits">
    <p className="project-credit">Built through the <a href="https://criticalai.commons.gc.cuny.edu/">Critical AI Literacy Institute</a>. A continuing project with the <a href="https://ailab.gc.cuny.edu/">CUNY AI Lab</a>.</p>
    {import.meta.env.VITE_ACCOUNT_WORKSPACE === 'true' && <a className="project-guide" href={GUIDE_URL} target="_blank" rel="noopener noreferrer">Guide<span className="sr-only"> (opens in a new tab)</span></a>}
    {children}
  </footer>;
}

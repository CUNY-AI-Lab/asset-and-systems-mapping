import { useLayoutEffect, useRef } from 'react';

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
    <p className="project-credit">Built through the Critical AI Literacy Institute. A continuing project with the <a href="https://ailab.gc.cuny.edu/">CUNY AI Lab</a>.</p>
    {children}
  </footer>;
}

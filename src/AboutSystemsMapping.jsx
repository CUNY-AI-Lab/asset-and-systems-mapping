import React, { useEffect, useId, useRef, useState } from 'react';
import './about-systems-mapping.css';

export const ABOUT_SYSTEMS_MAPPING = [
  'Systems Mapping turns a memo into a network map of the people, places, policies and broader conditions it describes, arranged from local settings outward. The method draws on asset mapping and ecological systems theory.',
  'Upload your first memo to place people, places, and resources on the map, then use Notebook to create and label their relationships.',
  'Add your second memo to extend the map to institutions and broader conditions; edit either memo in Memo and choose Update map to incorporate your changes.',
];
export const ABOUT_FLAG_DURATION = 12_000;

export default function AboutSystemsMapping() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const remaining = useRef(ABOUT_FLAG_DURATION);
  const id = useId();

  useEffect(() => {
    if (!open || hovered || focused) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => setOpen(false), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [open, hovered, focused]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = event => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      const restoreFocus = panel.current?.contains(document.activeElement);
      setOpen(false);
      if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <div ref={root} className="about-systems-mapping">
    <button ref={trigger} className="about-systems-mapping__trigger" type="button" aria-label="About Systems Mapping" aria-expanded={open} aria-controls={id} onClick={() => {
      if (open) { setOpen(false); return; }
      remaining.current = ABOUT_FLAG_DURATION;
      setHovered(false); setFocused(false); setOpen(true);
    }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" /></svg>
    </button>
    {open && <section ref={panel} id={id} className="about-systems-mapping__flag" role="region" aria-labelledby={`${id}-title`} tabIndex="0"
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <h2 id={`${id}-title`}>About Systems Mapping</h2>
      {ABOUT_SYSTEMS_MAPPING.map(text => <p key={text}>{text}</p>)}
    </section>}
  </div>;
}

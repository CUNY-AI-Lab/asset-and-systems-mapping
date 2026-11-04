import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

// Drafts belong to the selected record. Blur and selection changes never save.
export default function MapTextEditor({ label, value, maxLength, options, validate, onSave }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const fieldRef = useRef(null);
  const actionsRef = useRef(null);
  const errorId = useId();
  const hasDraft = draft !== value;
  useEffect(() => { setDraft(value); setError(''); }, [value]);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || options) return;
    const fit = () => { field.style.height = 'auto'; field.style.height = `${Math.max(44, field.scrollHeight + 2)}px`; };
    fit();
    let width = field.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const nextWidth = field.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; fit(); }
    });
    observer?.observe(field);
    return () => observer?.disconnect();
  }, [draft, options]);
  useLayoutEffect(() => {
    // Keep explicit Save / Cancel reachable in the compact Notebook without
    // changing the map's size, camera, selection or keyboard focus.
    const actions = actionsRef.current;
    const scroller = actions?.closest('.inspector__scroll');
    if (!scroller) return;
    const overflow = actions.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    if (overflow > 0) scroller.scrollTop += overflow + 8;
  }, [hasDraft, error]);
  const cancel = () => { setDraft(value); setError(''); fieldRef.current?.focus(); };
  const save = () => {
    const next = draft.trim();
    const issue = validate(next);
    if (issue) { setError(issue); fieldRef.current?.focus(); return; }
    if (next !== value) onSave(next);
    setDraft(next);
    setError('');
    fieldRef.current?.focus();
  };
  const fieldProps = {
    ref: fieldRef, value: draft, maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    onChange: (event) => { setDraft(event.target.value); setError(''); },
    onKeyDown: (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); save(); }
    },
  };
  return <div className="map-text-editor">
    <label className="field"><span className="field__label">{label}</span>
      {options ? <select {...fieldProps}>{[...new Set([value, ...options])].map(option => <option key={option}>{option}</option>)}</select> : <textarea className="map-label-input" rows="1" {...fieldProps} />}
    </label>
    {error && <p id={errorId} className="map-text-editor__error" role="alert">{error}</p>}
    {hasDraft && <div ref={actionsRef} className="map-text-editor__actions">
      <button type="button" className="button button--small" onClick={save}>Save</button>
      <button type="button" className="button button--small button--ghost" onClick={cancel}>Cancel</button>
    </div>}
  </div>;
}

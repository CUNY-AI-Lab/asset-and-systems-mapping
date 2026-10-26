import React, { useEffect, useId, useRef, useState } from 'react';

// Drafts belong to the selected record. Blur and selection changes never save.
export default function MapTextEditor({ label, value, maxLength, options, validate, onSave }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const fieldRef = useRef(null);
  const errorId = useId();
  useEffect(() => { setDraft(value); setError(''); }, [value]);
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
      {options ? <select {...fieldProps}>{[...new Set([value, ...options])].map(option => <option key={option}>{option}</option>)}</select> : <input {...fieldProps} />}
    </label>
    {error && <p id={errorId} className="map-text-editor__error" role="alert">{error}</p>}
    {draft !== value && <div className="map-text-editor__actions">
      <button type="button" className="button button--small" onClick={save}>Save</button>
      <button type="button" className="button button--small button--ghost" onClick={cancel}>Cancel</button>
    </div>}
  </div>;
}

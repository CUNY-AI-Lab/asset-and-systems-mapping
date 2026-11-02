import React, { useEffect, useRef, useState } from 'react';
import { readMemoFile } from './documentImport.js';

export default function CourseMaterialUpload({ value, onChange, disabled }) {
  const [pending, setPending] = useState(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const currentValue = useRef(value);
  currentValue.current = value;
  useEffect(() => () => { request.current += 1; }, []);
  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const revision = ++request.current;
    const original = value;
    setPending(null); setError(''); setReading(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a file smaller than 10 MB.');
      const result = await readMemoFile(file, { maxCharacters: 4000 });
      if (request.current !== revision) return;
      if (currentValue.current !== original) throw new Error('Course material changed while reading. Upload again to keep your latest edits.');
      if (!result.text.trim()) throw new Error('No text found. Use a text-based PDF, DOCX, or text file.');
      setPending({ ...result, name: file.name, original });
    } catch (cause) {
      if (request.current === revision) setError(/too large|smaller than|changed while|No text|You can import/.test(cause.message) ? cause.message : 'This file could not be read. Try a text-based PDF, DOCX, or text file.');
    } finally { if (request.current === revision) setReading(false); }
  };
  const apply = append => {
    if (!pending || disabled) return;
    if (pending.original !== value) { setError('Course material changed. Upload again to keep your latest edits.'); return; }
    const text = append && value.trim() ? `${value}\n\n${pending.text}` : pending.text;
    if (text.length > 4000) { setError('Course material is limited to 4,000 characters. Shorten the passage before adding this file.'); return; }
    onChange(text); setPending(null); setError('');
  };
  return <div className="course-material-upload">
    <label className="field"><span className="field__label">Upload course material</span><input type="file" accept=".docx,.pdf,.txt,.md,.html,.htm,.json" disabled={disabled || reading} onChange={upload} /></label>
    <p className="field__hint">DOCX, PDF or text · up to 4,000 characters. Imported text is saved with this section.</p>
    {reading && <p role="status">Reading file…</p>}
    {error && <p role="alert">{error}</p>}
    {pending && <section aria-label="Course material import preview"><strong>{pending.name}</strong><p>{pending.notice}</p><pre>{pending.text}</pre><div className="button-row"><button type="button" className="button button--secondary" disabled={disabled} onClick={() => apply(false)}>{value.trim() ? 'Replace course material' : 'Use imported text'}</button>{value.trim() && <button type="button" className="button button--secondary" disabled={disabled} onClick={() => apply(true)}>Append to course material</button>}<button type="button" className="button button--ghost" onClick={() => setPending(null)}>Cancel import</button></div></section>}
  </div>;
}

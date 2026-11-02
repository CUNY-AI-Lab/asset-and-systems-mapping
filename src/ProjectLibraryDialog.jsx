import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, projectMarkdown } from './App.jsx';
import { Action } from './ui/StudioPrimitives.jsx';
import { createPortableProject, exportFileName, PROJECT_LIMITS, SCALE_ORDER, SCALES, serializePortableProject } from './domain.js';
import { fieldNotesQuestions } from '../shared/field-notes.js';
import { downloadBlob, exportMapImage } from './mapExport.js';
import { progressLabel } from './projectProgress.js';
import { userFacingError } from './userFacingError.js';

export default function ProjectLibraryDialog({ selection, onClose, onSave, onDelete, onOpen }) {
  const [level, setLevel] = useState(selection.project.activeScale);
  const [project, setProject] = useState(selection.project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const closeState = useRef({busy,dirty,onClose});
  closeState.current = {busy,dirty,onClose};
  const close = useCallback(() => {
    const current = closeState.current;
    if (current.busy) return;
    if (current.dirty && !window.confirm('Discard unsaved note changes?')) return;
    current.onClose();
  },[]);
  const run = async action => {
    if (busy) return;
    setBusy(true); setError(''); setStatus('');
    try { await action(); }
    catch (cause) { setError(userFacingError(cause, 'This action could not be completed. Your work is still available. Download a private backup before leaving.')); }
    finally { setBusy(false); }
  };
  const exportFile = async (format, snapshot = project) => {
    if (format === 'json') downloadBlob(new Blob([serializePortableProject(snapshot, 'private')], {type:'application/json'}), exportFileName(snapshot, 'json'));
    else if (format === 'markdown') downloadBlob(new Blob([projectMarkdown(createPortableProject(snapshot, 'private'))], {type:'text/markdown'}), exportFileName(snapshot, 'md'));
    else downloadBlob(await exportMapImage(createPortableProject(snapshot, 'private'), format), exportFileName(snapshot, format));
    setStatus('Downloaded.');
  };
  const note = level === project.activeScale ? project.reflection : project.levelProgress?.[level]?.reflection || '';
  const writeNote = value => {
    setProject(current => {
      const next = structuredClone(current);
      if (level === next.activeScale) next.reflection = value;
      next.levelProgress[level] = {...next.levelProgress[level], reflection:value};
      return next;
    });
    setDirty(true); setStatus('');
  };
  const save = () => run(async () => {
    const next = {...project, updatedAt:new Date().toISOString()};
    await onSave(next, selection.revision);
    setProject(next); setDirty(false); setStatus('Saved');
  });
  const deleting = selection.mode === 'delete';
  return <Modal open title={project.title} onClose={close}>
    <div className="library-dialog">
      <p className="library-progress">{progressLabel(project)}</p>
      {selection.conflict && <p role="alert">The account and device copies differ. Export either copy before resolving them in the map.</p>}
      {deleting ? <>
        <p>Delete this saved project? A private recovery copy will remain on this device. Existing shared links are unchanged.</p>
        <label className="check-label"><input type="checkbox" checked={deleteConfirmed} disabled={busy} onChange={event => setDeleteConfirmed(event.target.checked)} />Delete {project.title}</label>
        <div className="button-row"><Action variant="secondary" disabled={busy} onClick={close}>Cancel</Action><Action disabled={busy || !deleteConfirmed} onClick={() => run(async () => { await onDelete(selection); onClose(); })}>Delete</Action></div>
      </> : <>
        <section aria-label="Project Field Notes" className="library-notes">
          <label className="field"><span className="field__label">Level</span><select value={level} onChange={event => setLevel(event.target.value)}>{SCALE_ORDER.filter(scale => project.releasedScales.includes(scale)).map(scale => <option key={scale} value={scale}>{SCALES[scale].label}</option>)}</select></label>
          <p id="library-notes-question" className="reflection-prompt">{fieldNotesQuestions(project.teacherGovernance?.preflight)[level]}</p>
          <label className="field"><span className="field__label">Field Notes</span><textarea rows={4} maxLength={PROJECT_LIMITS.promptText} aria-describedby="library-notes-question" value={note} disabled={busy || selection.conflict} onChange={event => writeNote(event.target.value)} /></label>
          <Action disabled={busy || !dirty || selection.conflict} onClick={save}>Save note</Action>
        </section>
        <section aria-label="Private project exports"><h2>Private exports</h2>
          <div className="library-format-actions"><Action variant="secondary" disabled={busy} onClick={() => run(() => exportFile('json'))}>Private backup</Action><Action variant="secondary" disabled={busy} onClick={() => run(() => exportFile('markdown'))}>Notes (Markdown)</Action>{project.graph.nodes.length > 0 && <><Action variant="secondary" disabled={busy} onClick={() => run(() => exportFile('png'))}>PNG</Action><Action variant="secondary" disabled={busy} onClick={() => run(() => exportFile('pdf'))}>PDF</Action></>}</div>
          {selection.conflict && selection.remote && <Action variant="secondary" disabled={busy} onClick={() => run(() => exportFile('json', selection.remote))}>Account backup</Action>}
        </section>
        <div className="library-return"><Action disabled={busy || dirty} onClick={() => onOpen(selection.record)}>Open project</Action></div>
      </>}
      {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}

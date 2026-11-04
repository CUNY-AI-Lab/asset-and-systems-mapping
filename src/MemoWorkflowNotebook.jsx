import React, { useEffect, useState } from 'react';
import { SCALE_ORDER } from './domain.js';
import { activeSubmission, isPart2 } from './projectMemo.js';
import { MEMO_WORKFLOW } from './memoWorkflow.js';
import ReflectionEntry from './ReflectionEntry.jsx';

// The account Notebook has one current task. Uploads and notes use the same
// project persistence and draft journal as the map; no parallel wizard state.
export default function MemoWorkflowNotebook({ project, update, uploadControl, onTextChange, onSubmitMemo, onEditMemo, onSelectStep, busy, failure, retryPending, saveState, onSaveNote, savedMapNote }) {
  const [editingMemo, setEditingMemo] = useState(false);
  const nodeStep = ['micro', 'exosphere'].includes(project.activeScale);
  const submission = activeSubmission(project);
  const info = MEMO_WORKFLOW[project.activeScale];
  const showMemo = nodeStep && (editingMemo || project.stage < 3 || !submission.text.trim() || !project.graph.nodes.some(node => node.scale === project.activeScale && node.status !== 'rejected' && node.claimState !== 'retired'));
  useEffect(() => { setEditingMemo(false); }, [project.activeScale, project.stage]);
  return <section className="memo-workflow-notebook" aria-label="Current mapping step">
    <nav className="workflow-steps" aria-label="Mapping steps">{SCALE_ORDER.map((scale, index) => <button key={scale} type="button" aria-current={scale === project.activeScale ? 'step' : undefined} onClick={() => onSelectStep(scale)}><span>{index + 1}</span>{['Micro', 'Meso', 'Exo', 'Macro'][index]}</button>)}</nav>
    <h2>{info.title}</h2><p className="workflow-instruction">{info.instruction}</p>
    <div className="workflow-memos" aria-label="Saved memos">{[project.submission, project.part2Submission].map((memo, index) => Boolean(index) === isPart2(project.activeScale) && memo?.text.trim() ? <div key={index}><span><strong>Memo {index + 1}</strong><span>{memo.fileName || memo.title || 'Typed memo'}</span></span><button className="button button--secondary" type="button" onClick={() => { if (nodeStep && isPart2(project.activeScale) === Boolean(index)) setEditingMemo(true); else onEditMemo(index ? 'exosphere' : 'micro'); }}>Edit</button></div> : null)}</div>
    {showMemo && <div className="workflow-memo-editor">
      <div className="memo-submit-top"><button type="button" className="button" disabled={busy || retryPending || !submission.text.trim() || submission.sensitive && !submission.consent} onClick={onSubmitMemo}>{busy ? 'Adding nodes…' : 'Submit memo and add nodes'}</button></div>
      {uploadControl}
      <label className="field"><span>{isPart2(project.activeScale) ? 'Second memo' : 'First memo'}</span><textarea rows="6" maxLength="500000" value={submission.text} onChange={event => onTextChange(event.target.value)} /></label>
      <label className="check-row"><input type="checkbox" checked={submission.sensitive} onChange={event => update(draft => { activeSubmission(draft).sensitive = event.target.checked; })} /><span>Includes private information</span></label>
      {submission.sensitive && <label className="check-row"><input type="checkbox" checked={submission.consent} onChange={event => update(draft => { activeSubmission(draft).consent = event.target.checked; })} /><span>I have permission to share it, or I have removed identifying details.</span></label>}
      <p className="privacy-note">Submitting sends this memo and your map to CAIL Gateway to identify nodes. You can edit or remove them afterward.</p>
    </div>}
    {failure && <p role="alert">{failure.message}</p>}
    {!showMemo && <details className="workflow-notes"><summary>Field notes <span>(optional)</span></summary><ReflectionEntry project={project} update={update} onSave={onSaveNote} saveState={saveState} required={false} />{project.mapAnnotation.text.trim() && savedMapNote}</details>}
  </section>;
}

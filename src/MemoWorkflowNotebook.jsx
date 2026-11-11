import React from 'react';
import { SCALE_ORDER } from './domain.js';
import { MEMO_WORKFLOW, WORKFLOW_GUIDE, memoUpdateState, withheldNodes, withheldNodeReason, reachableWorkflowScales, workflowStepReady } from './memoWorkflow.js';
import ReflectionEntry from './ReflectionEntry.jsx';

// Sources live in Memo; Notebook describes work on the same canvas.
export default function MemoWorkflowNotebook({ project, update, onEditMemo, onSelectStep, busy, saveState, onSaveNote, savedMapNote, onAddLeftOut }) {
  const info = MEMO_WORKFLOW[project.activeScale];
  const state = memoUpdateState(project);
  const nodeStep = ['micro', 'exosphere'].includes(project.activeScale);
  const hasNodes = project.graph.nodes.some(node => node.scale === project.activeScale && node.status !== 'rejected' && node.claimState !== 'retired');
  // A left-out name the student has since added to the map leaves the list.
  const nameKey = label => String(label ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
  const onMap = new Set(project.graph.nodes.filter(node => node.status !== 'rejected' && node.claimState !== 'retired').map(node => nameKey(node.label)));
  const leftOut = state.submitted && nodeStep ? withheldNodes(project).filter(item => !onMap.has(nameKey(item.label))) : [];
  const reachable = new Set(reachableWorkflowScales(project));
  const ready = workflowStepReady(project);
  // What to do at this step is said once, in the corner of the map. The
  // Notebook only names the step, and says when the memo still has to be read.
  const instruction = !state.submitted ? WORKFLOW_GUIDE.memo : nodeStep && !hasNodes ? 'No supported nodes were identified here. Add a node in Tools, or Continue.' : null;
  // Steps beyond the next one stay visible but closed, so the order of the
  // work is clear without letting a student skip over a step.
  return <section className="memo-workflow-notebook" aria-label="Current mapping step" data-step-ready={ready ? 'true' : undefined}>
    <nav className="workflow-steps" aria-label="Mapping steps">{SCALE_ORDER.map((scale, index) => <button key={scale} type="button" disabled={busy || !reachable.has(scale)} aria-disabled={!reachable.has(scale) || undefined} aria-current={scale === project.activeScale ? 'step' : undefined} onClick={() => onSelectStep(scale)}>{['Micro', 'Meso', 'Exo', 'Macro'][index]}</button>)}</nav>
    <h2>{info.title}</h2>
    {instruction && <p className="workflow-instruction">{instruction}</p>}
    {!state.submitted && <button className="button button--secondary" type="button" disabled={busy} onClick={() => onEditMemo()}>Open Memo</button>}
    {leftOut.length > 0 && <section className="workflow-left-out" aria-labelledby="workflow-left-out-heading">
      <h3 id="workflow-left-out-heading">Left out</h3>
      <ul>{leftOut.map((item, index) => <li key={`${item.label}:${index}`}><strong>{item.label}</strong><span>{withheldNodeReason(item.reason)}</span>{onAddLeftOut && <button type="button" className="button button--secondary" disabled={busy} aria-label={`Add ${item.label}`} onClick={() => onAddLeftOut(item)}>Add</button>}</li>)}</ul>
      <p>Add any of these that the memo supports.</p>
    </section>}
    <details className="workflow-notes"><summary>Field notes <span>(optional)</span></summary><ReflectionEntry project={project} update={update} onSave={onSaveNote} saveState={saveState} required={false} />{project.mapAnnotation.text.trim() && savedMapNote}</details>
  </section>;
}

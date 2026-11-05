import React from 'react';
import { SCALE_ORDER } from './domain.js';
import { MEMO_WORKFLOW, memoUpdateState } from './memoWorkflow.js';
import ReflectionEntry from './ReflectionEntry.jsx';

// Sources live in Memo; Notebook describes work on the same canvas.
export default function MemoWorkflowNotebook({ project, update, onEditMemo, onSelectStep, busy, saveState, onSaveNote, savedMapNote }) {
  const info = MEMO_WORKFLOW[project.activeScale];
  const state = memoUpdateState(project);
  const nodeStep = ['micro', 'exosphere'].includes(project.activeScale);
  const hasNodes = project.graph.nodes.some(node => node.scale === project.activeScale && node.status !== 'rejected' && node.claimState !== 'retired');
  const instruction = !state.submitted
    ? 'Open Memo and add its nodes to the map to continue.'
    : nodeStep && !hasNodes
      ? 'No supported nodes were identified here. Add a node in Tools, or Continue.'
      : project.activeScale === 'micro'
        ? 'Select a node to edit it. Double-click a node to start a connection.'
        : project.activeScale === 'exosphere'
          ? 'Select an Exo node and connect it to the local relationships it affects.'
        : info.instruction;
  return <section className="memo-workflow-notebook" aria-label="Current mapping step">
    <nav className="workflow-steps" aria-label="Mapping steps">{SCALE_ORDER.map((scale, index) => <button key={scale} type="button" disabled={busy} aria-current={scale === project.activeScale ? 'step' : undefined} onClick={() => onSelectStep(scale)}>{['Micro', 'Meso', 'Exo', 'Macro'][index]}</button>)}</nav>
    <h2>{info.title}</h2>
    <p className="workflow-instruction">{instruction}</p>
    {!state.submitted && <button className="button button--secondary" type="button" disabled={busy} onClick={() => onEditMemo()}>Open Memo</button>}
    <details className="workflow-notes"><summary>Field notes <span>(optional)</span></summary><ReflectionEntry project={project} update={update} onSave={onSaveNote} saveState={saveState} required={false} />{project.mapAnnotation.text.trim() && savedMapNote}</details>
  </section>;
}

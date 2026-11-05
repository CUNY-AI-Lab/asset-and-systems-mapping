import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MemoWorkflowNotebook from './MemoWorkflowNotebook.jsx';
import { createDefaultProject, parseProject, serializeProject, stableId } from './domain.js';
import { appendSubmittedNodes, openMemoWorkflowScale } from './memoWorkflow.js';

afterEach(cleanup);
const props = { update: vi.fn(), onSelectStep: vi.fn(), onSubmitMemo: vi.fn(), onEditMemo: vi.fn(), onSaveNote: vi.fn() };
function mappedProject(stage = 2) {
  const project = createDefaultProject();
  project.submission.text = 'Residents meet at the community center.';
  appendSubmittedNodes(project, {nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text}],connections:[]});
  project.stage = stage;
  return parseProject(serializeProject(project));
}

it('opens a saved legacy review-stage map without asking for the memo again', () => {
  const project = mappedProject();
  expect(project.stage).toBe(2);
  render(<MemoWorkflowNotebook {...props} project={project} />);
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
  expect(screen.queryByRole('textbox',{name:'First memo'})).toBeNull();
  expect(screen.getByText('Edit a node, or Continue to draw relationships.')).toBeVisible();
  expect(screen.getByRole('button',{name:'Edit'})).toBeVisible();
});

it('allows explicit editing and returns to the node view after resubmission completes', () => {
  const project = mappedProject();
  const submit = vi.fn();
  const view = render(<MemoWorkflowNotebook {...props} project={project} onSubmitMemo={submit} />);
  fireEvent.click(screen.getByRole('button',{name:'Edit'}));
  expect(screen.getByRole('textbox',{name:'First memo'})).toHaveValue(project.submission.text);
  fireEvent.click(screen.getByRole('button',{name:'Submit memo and add nodes'}));
  expect(submit).toHaveBeenCalledOnce();
  const submitting = {...project,stage:1};
  view.rerender(<MemoWorkflowNotebook {...props} project={submitting} busy />);
  expect(screen.getByRole('button',{name:'Adding nodes…'})).toBeDisabled();
  expect(screen.getByRole('textbox',{name:'First memo'})).toHaveValue(project.submission.text);
  const completed = structuredClone(submitting);
  appendSubmittedNodes(completed,{nodes:[],connections:[]});
  completed.events.push({id:'review-complete',at:new Date().toISOString(),actor:'student',action:'preflight.completed',detail:'Submitted memo nodes added to map',sourceFingerprint:stableId('src',completed.submission.text)});
  view.rerender(<MemoWorkflowNotebook {...props} project={parseProject(serializeProject(completed))} />);
  expect(screen.queryByRole('textbox',{name:'First memo'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
});

it.each([0,1])('keeps a new or in-progress memo editable at stage %i despite retained nodes', stage => {
  const project = mappedProject(stage);
  render(<MemoWorkflowNotebook {...props} project={project} />);
  expect(screen.getByRole('textbox',{name:'First memo'})).toHaveValue(project.submission.text);
  expect(screen.getByRole('button',{name:'Submit memo and add nodes'})).toBeEnabled();
});

it('keeps a failed retry available without treating retained nodes as a completed submission', () => {
  render(<MemoWorkflowNotebook {...props} project={mappedProject(1)} failure={{message:'The memo could not be read. Try again.'}} />);
  expect(screen.getByRole('alert')).toHaveTextContent('The memo could not be read. Try again.');
  expect(screen.getByRole('textbox',{name:'First memo'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Submit memo and add nodes'})).toBeEnabled();
});

it('shows an empty second memo while retaining the first memo graph', () => {
  const project = mappedProject();
  openMemoWorkflowScale(project,'exosphere');
  render(<MemoWorkflowNotebook {...props} project={parseProject(serializeProject(project))} />);
  expect(screen.getByRole('textbox',{name:'Second memo'})).toHaveValue('');
  expect(screen.getByRole('button',{name:'Submit memo and add nodes'})).toBeDisabled();
  expect(screen.queryByText(project.submission.text)).toBeNull();
});

it.each([2,3])('keeps a successful empty submission complete after navigation and reload at stage %i', stage => {
  const project = createDefaultProject();
  project.graph = {nodes:[],edges:[]};
  openMemoWorkflowScale(project,'exosphere');
  project.part2Submission.text = 'Schools need funding and the government should help.';
  project.events.push({id:'empty-review',at:new Date().toISOString(),actor:'student',action:'preflight.completed',detail:'Submitted memo nodes added to map',sourceFingerprint:stableId('src',project.part2Submission.text)});
  openMemoWorkflowScale(project,'macrosphere');openMemoWorkflowScale(project,'exosphere');
  project.stage = stage;
  render(<MemoWorkflowNotebook {...props} project={parseProject(serializeProject(project))} />);
  expect(screen.getByText(/No supported nodes were identified/)).toHaveAttribute('role','status');
  expect(screen.queryByText(/Select an Exo node/)).toBeNull();
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
  expect(screen.getByRole('button',{name:'Edit'})).toBeVisible();
});
it.each([2,3])('does not reopen memo submission when the last mapped node was removed at stage %i', stage => {
  const project=mappedProject(stage);
  project.graph.nodes[0].status='rejected';project.graph.nodes[0].claimState='retired';
  render(<MemoWorkflowNotebook {...props} project={project} />);
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
  expect(screen.getByText('Add a node in Tools, or Continue.')).toHaveAttribute('role','status');
  expect(screen.queryByText('Edit a node, or Continue to draw relationships.')).toBeNull();
});

it('directs students to Macro when Part 2 has Macro nodes and no Exo settings', () => {
  const project=mappedProject();
  openMemoWorkflowScale(project,'exosphere');
  project.part2Submission.text='Attendance policy sets school attendance requirements.';
  appendSubmittedNodes(project,{nodes:[{label:'Attendance policy',type:'policy',scale:'macrosphere',basis:'memo',evidence:project.part2Submission.text}],connections:[]});
  render(<MemoWorkflowNotebook {...props} project={parseProject(serializeProject(project))} />);
  expect(screen.getByText('Continue to Macro, or add an outside setting in Tools.')).toHaveAttribute('role','status');
  expect(screen.queryByText(/Select an Exo node/)).toBeNull();
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
  expect(screen.getByRole('button',{name:/Macro$/})).toBeEnabled();
});

it('offers Tools or Continue when every Part 2 node has been removed', () => {
  const project=mappedProject();
  openMemoWorkflowScale(project,'exosphere');
  project.part2Submission.text='City Housing Authority manages repairs. Attendance policy sets school attendance requirements.';
  appendSubmittedNodes(project,{nodes:[{label:'City Housing Authority',type:'agency',scale:'exosphere',basis:'memo',evidence:project.part2Submission.text},{label:'Attendance policy',type:'policy',scale:'macrosphere',basis:'memo',evidence:project.part2Submission.text}],connections:[]});
  for (const node of project.graph.nodes.filter(node=>['exosphere','macrosphere'].includes(node.scale))) { node.status='rejected';node.claimState='retired'; }
  render(<MemoWorkflowNotebook {...props} project={parseProject(serializeProject(project))} />);
  expect(screen.getByText('Add a node in Tools, or Continue.')).toHaveAttribute('role','status');
  expect(screen.queryByText(/Select an Exo node/)).toBeNull();
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
});

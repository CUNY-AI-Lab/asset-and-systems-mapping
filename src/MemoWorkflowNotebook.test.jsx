import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MemoWorkflowNotebook from './MemoWorkflowNotebook.jsx';
import MemoWorkspace from './MemoWorkspace.jsx';
import { parseProject, serializeProject, stableId } from './domain.js';
import { createBlankProject } from './App.jsx';
import { appendSubmittedNodes, openMemoWorkflowScale } from './memoWorkflow.js';

afterEach(cleanup);
const props = { update: vi.fn(), onSelectStep: vi.fn(), onEditMemo: vi.fn(), onSaveNote: vi.fn() };
function mappedProject() {
  const project=createBlankProject();
  project.submission.text='Residents meet at the community center.';
  project.submission.fingerprint=stableId('src',project.submission.text);
  appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text}],connections:[]});
  return parseProject(serializeProject(project));
}

it('keeps a saved map in Notebook without a duplicate memo editor or review requirement',()=>{
  render(<MemoWorkflowNotebook {...props} project={mappedProject()} />);
  expect(screen.getByRole('heading',{name:'Micro · local nodes'})).toBeVisible();
  expect(screen.queryByText(/Double-click/)).toBeNull();
  expect(screen.queryByRole('textbox',{name:'First memo'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
  expect(screen.queryByText('Update suggestions')).toBeNull();
});

it('directs an unfinished memo to the Memo tab while keeping notes optional',()=>{
  const project=createBlankProject(), open=vi.fn();
  render(<MemoWorkflowNotebook {...props} project={project} onEditMemo={open} />);
  fireEvent.click(screen.getByRole('button',{name:'Open Memo'}));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getByText('(optional)')).toBeVisible();
  expect(screen.queryByRole('textbox',{name:'First memo'})).toBeNull();
});

it('keeps successful empty results complete after reload',()=>{
  const project=createBlankProject();project.submission.text='More research is needed.';
  project.submission.fingerprint=stableId('src',project.submission.text);
  appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[],connections:[]});
  render(<MemoWorkflowNotebook {...props} project={parseProject(serializeProject(project))} />);
  expect(screen.getByText(/No supported nodes were identified/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'Open Memo'})).toBeNull();
});

it('removing the last node does not demand another model submission',()=>{
  const project=mappedProject();project.graph.nodes[0].status='rejected';project.graph.nodes[0].claimState='retired';
  render(<MemoWorkflowNotebook {...props} project={project} />);
  expect(screen.getByText(/Add a node in Tools, or Continue/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'Open Memo'})).toBeNull();
});

it('keeps a blank second memo independent from the retained first source',()=>{
  const project=mappedProject();openMemoWorkflowScale(project,'exosphere');
  render(<MemoWorkspace {...props} project={project} onTextChange={vi.fn()} onSelectPart={vi.fn()} />);
  expect(screen.getByRole('textbox',{name:'Second memo'})).toHaveValue('');
  expect(screen.queryByText(project.submission.text)).toBeNull();
  expect(project.graph.nodes).toHaveLength(1);
});

it('moves a successfully submitted second memo to Exo connection work',()=>{
  const project=mappedProject();openMemoWorkflowScale(project,'exosphere');
  project.part2Submission.text='Residents do not participate in Regional Housing Office staffing meetings. Regional Housing Office allocates repair staff, affecting repair visits to residents at home.';
  appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Regional Housing Office',type:'agency',scale:'exosphere',basis:'memo',evidence:project.part2Submission.text}],connections:[]});
  render(<MemoWorkflowNotebook {...props} project={parseProject(serializeProject(project))} />);
  expect(screen.getByRole('heading',{name:'Exo · policies and offices'})).toBeVisible();
  expect(screen.queryByText(/Submit your second memo/)).toBeNull();
  expect(screen.queryByRole('button',{name:'Open Memo'})).toBeNull();
});

it('shows the significant-edit cue and a retained failed-update draft in Memo',()=>{
  const project=mappedProject();project.submission.text+=' Residents request repairs.';
  const change=vi.fn();
  render(<MemoWorkspace {...props} project={project} onTextChange={change} onSelectPart={vi.fn()} failure={{message:'Could not update. Your map is unchanged.'}} />);
  expect(screen.getByText('Memo changed | click Update map to submit')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Your map is unchanged');
  expect(screen.getByRole('textbox',{name:'First memo'})).toHaveValue(project.submission.text);
  fireEvent.change(screen.getByRole('textbox',{name:'First memo'}),{target:{value:'A revised memo.'}});
  expect(change).toHaveBeenCalledWith('A revised memo.');
});

it('allows selecting the other independent memo without submitting it',()=>{
  const project=mappedProject(),select=vi.fn();
  render(<MemoWorkspace {...props} project={project} onTextChange={vi.fn()} onSelectPart={select} />);
  fireEvent.change(screen.getByRole('combobox',{name:'Memo part'}),{target:{value:'exosphere'}});
  expect(select).toHaveBeenCalledWith('exosphere');
  expect(project.part2Submission.text).toBe('');
});

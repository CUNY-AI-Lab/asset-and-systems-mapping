import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MemoWorkflowNotebook from './MemoWorkflowNotebook.jsx';
import { createDefaultProject, parseProject, serializeProject, stableId } from './domain.js';
import { openMemoWorkflowScale } from './memoWorkflow.js';

afterEach(cleanup);
const props = { update: vi.fn(), onSelectStep: vi.fn(), onSubmitMemo: vi.fn(), onEditMemo: vi.fn(), onSaveNote: vi.fn() };
it('keeps a successful empty submission complete after step navigation and reload', () => {
  const project = createDefaultProject();
  project.graph = {nodes:[],edges:[]};
  openMemoWorkflowScale(project,'exosphere');
  project.part2Submission.text = 'Schools need funding and the government should help.';
  project.events.push({id:'empty-review',at:new Date().toISOString(),actor:'student',action:'preflight.completed',detail:'Submitted memo nodes added to map',sourceFingerprint:stableId('src',project.part2Submission.text)});
  openMemoWorkflowScale(project,'macrosphere');openMemoWorkflowScale(project,'exosphere');
  render(<MemoWorkflowNotebook {...props} project={parseProject(serializeProject(project))} />);
  expect(screen.getByText(/No supported nodes were identified/)).toHaveAttribute('role','status');
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
  expect(screen.getByRole('button',{name:'Edit'})).toBeVisible();
});
it('does not reopen memo submission when a student removes the last mapped node', () => {
  const project=createDefaultProject();project.stage=3;project.activeScale='micro';
  project.graph.nodes=[{id:'removed',label:'Residents',scale:'micro',status:'rejected',claimState:'retired'}];
  render(<MemoWorkflowNotebook {...props} project={project} />);
  expect(screen.queryByRole('button',{name:'Submit memo and add nodes'})).toBeNull();
  expect(screen.getByText('Edit a node, or Continue to draw relationships.')).toBeVisible();
});

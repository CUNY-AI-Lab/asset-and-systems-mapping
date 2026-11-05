import React from 'react';
import { activeSubmission, isPart2 } from './projectMemo.js';
import { memoUpdateState } from './memoWorkflow.js';

export default function MemoWorkspace({ project, update, uploadControl, onTextChange, onSelectPart, busy, failure }) {
  const submission = activeSubmission(project);
  const part2 = isPart2(project.activeScale);
  const state = memoUpdateState(project);
  return <section className="memo-workspace" aria-label="Memo editor">
    <label className="field"><span className="field__label">Memo</span><select aria-label="Memo part" value={part2 ? 'exosphere' : 'micro'} disabled={busy} onChange={event => onSelectPart(event.target.value)}>
      <option value="micro">Part 1 · Local people and places</option>
      <option value="exosphere">Part 2 · Institutions and broader conditions</option>
    </select></label>
    {!submission.text.trim() && <p className="memo-start-cue" role="status">Start here: upload or paste your {part2 ? 'second' : 'first'} memo.</p>}
    {uploadControl}
    <label className="field"><span className="field__label">{part2 ? 'Second memo' : 'First memo'}</span><textarea rows="10" maxLength="500000" value={submission.text} onChange={event => onTextChange(event.target.value)} placeholder="Paste your memo here, or upload a file above." /></label>
    {state.hasBaseline && state.changed && <p className="memo-change-notice" role="status">Memo changed | click Update map to submit</p>}
    {submission.sensitive && !submission.consent && <label className="check-row"><input type="checkbox" checked={submission.consent} onChange={event => update(draft => { activeSubmission(draft).consent = event.target.checked; })} /><span>I have permission to share it, or I have removed identifying details.</span></label>}
    {failure && <p role="alert">{failure.message}</p>}
  </section>;
}

// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { SubmittedRevisions } from './submitted-revisions.js';
import { createDefaultProject } from '../src/domain.js';
test('counts explicit changed submissions per level and stage, excluding autosaves and repeated requests', () => {
  const db = new DatabaseSync(':memory:'); const revisions = new SubmittedRevisions(db);
  const p = createDefaultProject(); p.submission.text = 'Synthetic memo';
  expect(revisions.summary('alice', p.id)).toEqual([]);
  expect(revisions.submit('alice',p,1)).toEqual({ recorded:true });
  expect(revisions.submit('alice',p,1)).toEqual({ recorded:false });
  p.submission.revision = 20; p.submission.fingerprint = 'bookkeeping'; p.updatedAt = new Date().toISOString(); p.events = []; p.preflight = { id:'another-attempt' };
  expect(revisions.submit('alice',p,2)).toEqual({ recorded:false });
  p.submission.text = 'Revised memo'; expect(revisions.submit('alice',p,3).recorded).toBe(true);
  p.submission.text = 'Synthetic memo'; expect(revisions.submit('alice',p,4).recorded).toBe(true);
  p.activeScale='meso'; expect(revisions.submit('alice',p,5).recorded).toBe(true);
  p.stage=3; expect(revisions.submit('alice',p,6).recorded).toBe(true);
  expect(revisions.summary('alice',p.id)).toEqual(expect.arrayContaining([expect.objectContaining({scale:'micro',stage:0,count:3}),expect.objectContaining({scale:'meso',stage:0,count:1}),expect.objectContaining({scale:'meso',stage:3,count:1})]));
  expect(revisions.summary('bob',p.id)).toEqual([]); db.close();
});

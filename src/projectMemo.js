import { prepareProviderMemo } from '../shared/provider-memo.js';
import { stableId } from './domain.js';

// The two exercises share one graph, but keep independent source documents.
export const isPart2 = scale => ['exosphere', 'macrosphere'].includes(scale);
export const activeSubmission = project => isPart2(project.activeScale) && project.part2Submission
  ? project.part2Submission : project.submission;

export function beginPart2(project) {
  if (project.part2Submission) return;
  project.part2Submission = {
    ...project.submission, id: stableId('submission-part2', `${project.id}:${project.submission.id}`), title: '', text: '',
    author: '', date: '', sourceType: '', location: '', rights: '', evidenceOwnership: '',
    sensitive: false, consent: false, revision: 1,
  };
  delete project.part2Submission.analysis;
  delete project.part2Submission.fingerprint;
  delete project.part2Submission.fileName;
  delete project.part2Submission.fileSize;
}

export function reviewMemoText(project) {
  const active = activeSubmission(project);
  if (!isPart2(project.activeScale) || !project.part2Submission) return active.text;
  // Strip reference lists independently so a Part 1 bibliography cannot swallow
  // Part 2. Original files/text remain intact in their separate source records.
  return `PART 1 MEMO — MICROSYSTEM\n${prepareProviderMemo(project.submission.text).sourceText}\n\nPART 2 MEMO — MACROSYSTEM\n${prepareProviderMemo(active.text).sourceText}`;
}

export const memoLabel = project => isPart2(project.activeScale)
  ? 'Part 2 memo · Macrosystem' : 'Part 1 memo · Microsystem';

import { stableId } from './domain.js';

// Existing saved maps remain continuations; a new, empty map needs a model seed.
export function hasStartedMappingCycle(project) {
  const fingerprint = project.submission.fingerprint || stableId('src', project.submission.text);
  const review = project.preflight;
  if (review?.memoReview && review.evaluation && review.sourceFingerprint === fingerprint) return true;
  if (project.events?.some(event => event.action === 'preflight.completed'
    && event.configurationSnapshot && event.runtime && event.evaluation
    && (!event.sourceFingerprint || event.sourceFingerprint === fingerprint))) return true;
  if (project.graph.nodes.length || project.graph.edges.length) return true;
  return [...project.candidates.nodes, ...project.candidates.edges]
    .some(item => item.status === 'confirmed'
      || item.origin === 'model suggestion' && item.sourceFingerprint === fingerprint);
}

export function requiresInitialModel(project) {
  return !hasStartedMappingCycle(project);
}

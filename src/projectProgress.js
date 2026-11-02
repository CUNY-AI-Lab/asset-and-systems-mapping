import { SCALE_ORDER, SCALES } from './domain.js';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';

export function projectProgress(project) {
  const live = item => item.status !== 'rejected' && item.claimState !== 'retired';
  return {
    activeScale: project.activeScale,
    stage: project.stage,
    nodes: project.graph.nodes.filter(item => live(item) && item.scale !== 'meso').length,
    relationships: project.graph.edges.filter(live).length,
    completedLevels: project.completedScales?.length || 0,
    hasMemo: Boolean(project.submission?.text?.trim()),
    notes: SCALE_ORDER.filter(scale => String(scale === project.activeScale ? project.reflection : project.levelProgress?.[scale]?.reflection || '').trim()).length,
  };
}

export function progressLabel(record) {
  const progress = record.progress || record;
  return [SCALES[progress.activeScale]?.label, SYSTEMS_MAPPING_STAGES[progress.stage]?.short].filter(Boolean).join(' · ') || 'Progress unavailable';
}

export function progressDetail(record) {
  const progress = record.progress || record;
  return [progress.hasMemo ? 'Memo added' : '', Number.isInteger(progress.nodes) ? `${progress.nodes} nodes` : '', Number.isInteger(progress.relationships) ? `${progress.relationships} relationships` : '', progress.notes > 0 ? `Field Notes at ${progress.notes} ${progress.notes === 1 ? 'level' : 'levels'}` : ''].filter(Boolean).join(' · ');
}

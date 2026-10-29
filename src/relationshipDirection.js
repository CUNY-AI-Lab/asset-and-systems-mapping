export function relationshipDirection(edge) {
  return edge.relationshipProcess?.direction || 'source to target';
}

export function relationshipArrowheads(edge) {
  if (edge.directed === false || edge.relationshipProcess?.connectionStatus === 'missing') return { start: false, end: false };
  const direction = relationshipDirection(edge);
  return {
    start: ['target to source', 'both directions'].includes(direction),
    end: ['source to target', 'both directions'].includes(direction),
  };
}

export { relationshipDescription } from '../shared/relationship-process.js';

export function relationshipMapLabel(edge) {
  const process = edge.relationshipProcess || {};
  return [
    process.connectionStatus === 'missing' ? 'Missing connection' : '',
    edge.verb,
    !['source to target', 'target to source', 'both directions'].includes(relationshipDirection(edge)) ? (relationshipDirection(edge) === 'varies' ? 'direction varies' : 'direction not yet known') : '',
    process.strength && process.strength !== 'unknown' ? process.strength : '',
    Number.isInteger(process.familyCount) ? `${process.familyCount} ${process.familyCount === 1 ? 'family' : 'families'}` : '',
  ].filter(Boolean).join(' · ');
}

export function relationshipLineWidth(edge) {
  const count = edge.relationshipProcess?.familyCount;
  return Number.isInteger(count) ? 2 + Math.min(4, Math.log10(count + 1) * 2) : 2;
}

export function relationshipProcessSummary(process = {}) {
  return [
    ['Status', process.connectionStatus === 'unknown' ? '' : process.connectionStatus],
    ['Strength', process.strength === 'unknown' ? '' : process.strength],
    ['Channel', process.channel], ['Connecting work', process.connectingWork],
    ['Families', Number.isInteger(process.familyCount) ? String(process.familyCount) : ''],
    ['Frequency', process.frequency], ['Duration', process.duration], ['Direction', process.direction],
    ['Conditions', process.conditions], ['Change over time', process.changeOverTime],
  ].filter(([, value]) => String(value ?? '').trim()).map(([label, value]) => `${label}: ${value}`).join('; ');
}

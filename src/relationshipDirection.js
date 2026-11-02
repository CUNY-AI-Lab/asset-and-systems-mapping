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
  return edge.verb || '';
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

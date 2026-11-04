import { buildEastHarlemDisabilityProject } from '../e2e/fixtures/east-harlem-disability-project.js';
export function groupProject() {
  const project = buildEastHarlemDisabilityProject();
  project.activeScale = 'macrosphere';
  const heading = project.graph.nodes.find(node => node.scale === 'exosphere');
  const locals = project.graph.edges.filter(edge => edge.scale === 'meso').slice(0, 2);
  const target = project.graph.nodes.find(node => node.id === locals[0].source);
  const group = { ...structuredClone(locals[0]), id: 'macro-group', source: heading.id, sourceLabel: heading.label,
    target: target.id, targetLabel: target.label, scale: 'macrosphere', verb: 'shapes',
    relationshipIds: locals.map(edge => edge.id), annotation: { id: 'macro-group-annotation', text: 'A student interpretation, still to verify.' } };
  project.graph.edges.push(group);
  return project;
}

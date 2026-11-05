import {
  containsRetiredSystemsLanguage, isDiscreteMicroNodeLabel, isMesosystemLabel,
  isNamedInstitutionLabel, isObviousLowerLevelMacroLabel, isStatementMapElementLabel, isExplicitMacroPolicyLabel,
  labelRepeatsInstitution, normalizeMapElementLabel, scaleLexiconVerb,
} from './domain.js';

export function nodeLabelIssue(value, node, nodes) {
  if (!value || value.length > 200) return 'Enter a label of 1–200 characters.';
  if (isStatementMapElementLabel(value) || normalizeMapElementLabel(value, { micro: node.scale === 'micro' }) !== value.trim()) return 'Name one complete map item instead of a reference, time, modifier, action, or fragment.';
  if (containsRetiredSystemsLanguage(value)) return 'Use a direct, conventional name for the map item.';
  if (node.scale === 'micro' && !isDiscreteMicroNodeLabel(value)) return 'Name one specific person, role, group, activity, object, or immediate setting.';
  if (node.scale === 'meso' && !isMesosystemLabel(value)) return 'Name a linkage among at least two Micro settings, such as “home–school coordination.”';
  if (node.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(value)) return 'That label names an immediate person, role, activity, or schedule. Add it at Micro instead.';
  if (node.scale === 'macrosphere' && isNamedInstitutionLabel(value) && !isExplicitMacroPolicyLabel(value, node.type)) return 'Name a broader policy, condition, or belief rather than an institution.';
  if (node.scale === 'macrosphere' && !isExplicitMacroPolicyLabel(value, node.type) && labelRepeatsInstitution(value, nodes.filter(item => item.scale === 'exosphere'))) return 'That label names or repeats an institution. Add it at Exo-level instead.';
  return '';
}

export function relationshipIssue(value, edge) {
  if (!['micro', 'meso', 'exosphere', 'macrosphere'].includes(edge.scale)) return 'Edit relationships at Meso or Exo-level.';
  if (value.length > 100) return 'Use at most 100 characters.';
  return '';
}

// A candidate can have a different ID after a cross-level collision at commit.
// Never match a carried item at another level or an ambiguous label.
export function correspondingNode(node, nodes) {
  const exact = nodes.find(item => item.id === node.id && item.scale === node.scale);
  if (exact) return exact;
  const matches = nodes.filter(item => item.scale === node.scale && item.label === node.label);
  return matches.length === 1 ? matches[0] : null;
}

function correspondingEdge(project, collection, edge) {
  const endpointIdentity = (records, id) => {
    const node = records.nodes.find(item => item.id === id) || project.graph.nodes.find(item => item.id === id);
    if (!node) return null;
    const mapped = records === project.graph ? node : correspondingNode(node, project.graph.nodes);
    return JSON.stringify([mapped?.id || node.id, node.scale]);
  };
  const from = project[collection];
  const to = project[collection === 'graph' ? 'candidates' : 'graph'];
  const matches = to.edges.filter(item => item.scale === edge.scale
    && endpointIdentity(from, edge.source) === endpointIdentity(to, item.source)
    && endpointIdentity(from, edge.target) === endpointIdentity(to, item.target));
  const sameWording = matches.filter(item => item.verb === edge.verb);
  return matches.find(item => item.id === edge.id) || (sameWording.length === 1 ? sameWording[0] : null);
}

export function reviseMapText(project, collection, kind, id, value) {
  const from = project[collection];
  const to = project[collection === 'graph' ? 'candidates' : 'graph'];
  const item = from[kind].find(entry => entry.id === id);
  if (!item) return;
  const other = kind === 'nodes' ? correspondingNode(item, to.nodes) : correspondingEdge(project, collection, item);
  const field = kind === 'nodes' ? 'label' : 'verb';
  item[field] = value;
  if (other) other[field] = value;
  if (kind === 'nodes') {
    const graphNode = collection === 'graph' ? item : other;
    const candidateNode = collection === 'candidates' ? item : other;
    for (const records of [project.graph, project.candidates]) {
      records.edges.forEach(edge => {
        for (const endpoint of ['source', 'target']) {
          const owner = records === project.graph
            ? project.graph.nodes.find(node => node.id === edge[endpoint])
            : project.candidates.nodes.find(node => node.id === edge[endpoint])
              || project.graph.nodes.find(node => node.id === edge[endpoint]);
          if (owner && (owner === graphNode || owner === candidateNode)) edge[`${endpoint}Label`] = value;
        }
      });
    }
  }
}

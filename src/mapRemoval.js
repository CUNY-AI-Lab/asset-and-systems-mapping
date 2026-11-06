// Leave records and their evidence in the project so one saved edit can restore
// the exact map, including group membership and direction.
import { correspondingNode, correspondingEdge } from './mapTextEditing.js';

const live = item => item && item.status !== 'rejected' && item.claimState !== 'retired';
const retire = item => Object.assign(item, {status:'rejected', claimState:'retired', reviewDecision:'removed'});

export function removeMapSelection(project, kind, id) {
  const {nodes, edges} = project.graph, candidates = project.candidates;
  const target = (kind === 'node' ? nodes : edges).find(item => item.id === id);
  if (!live(target)) return;
  const goneNodes = new Set(kind === 'node' ? [id] : []);
  const goneEdges = new Set(kind === 'edge' ? [id] : []);
  // Old saved setting groups require two surviving members.
  let grew;
  do {
    grew = false;
    for (const n of nodes) {
      if (!live(n) || goneNodes.has(n.id) || !n.scopeNodeIds?.some(k => goneNodes.has(k))) continue;
      if (n.scopeNodeIds.filter(k => !goneNodes.has(k)).length < 2) { goneNodes.add(n.id); grew = true; }
    }
  } while (grew);

  const edgeById = new Map(edges.map(e => [e.id, e]));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const goneCandidateNodes = new Set(goneNodes);
  const goneCandidateEdges = new Set();
  for (const n of nodes) if (goneNodes.has(n.id)) {
    const mirror = correspondingNode(n, candidates.nodes);
    if (mirror) goneCandidateNodes.add(mirror.id);
  }
  for (const e of edges) if (live(e) && (goneNodes.has(e.source) || !e.relationshipIds && goneNodes.has(e.target))) goneEdges.add(e.id);

  function trimGroup(e, removedNodes) {
    if (!e.relationshipIds || !e.relationshipIds.some(k => goneEdges.has(k))) return true;
    const left = e.relationshipIds.filter(k => !goneEdges.has(k));
    if (!left.length) return false;
    const endpoints = left.flatMap(k => [edgeById.get(k)?.source, edgeById.get(k)?.target]);
    const anchor = !removedNodes.has(e.target) && endpoints.includes(e.target) ? e.target : endpoints[0];
    Object.assign(e, {relationshipIds:left, target:anchor, targetLabel:nodeById.get(anchor).label});
    return true;
  }
  // Find any counterpart before changing its endpoints. Candidate groups also
  // reference the committed graph's local edge IDs, even with different IDs.
  for (const e of edges) {
    if (!live(e)) continue;
    if (!goneEdges.has(e.id) && trimGroup(e, goneNodes)) continue;
    goneEdges.add(e.id);
    const mirror = correspondingEdge(project, 'graph', e);
    if (mirror) goneCandidateEdges.add(mirror.id);
    retire(e);
  }
  for (const e of candidates.edges) if (live(e) && (
    goneCandidateEdges.has(e.id) || goneCandidateNodes.has(e.source) ||
    !e.relationshipIds && goneCandidateNodes.has(e.target) || !trimGroup(e, goneCandidateNodes)
  )) retire(e);

  for (const [records, removed] of [[nodes, goneNodes], [candidates.nodes, goneCandidateNodes]]) {
    for (const n of records) {
      if (removed.has(n.id)) { retire(n); continue; }
      if (!live(n)) continue;
      for (const field of ['scopeNodeIds', 'settingNodeIds']) if (n[field]?.some(k => removed.has(k))) {
        const left = n[field].filter(k => !removed.has(k));
        if (field === 'scopeNodeIds' && left.length < 2) retire(n);
        else n[field] = left;
      }
    }
  }
}

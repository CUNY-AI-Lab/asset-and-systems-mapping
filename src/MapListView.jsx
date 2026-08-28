import React, { useMemo } from 'react';
import {
  SYSTEMS_MAPPING_LEVELS,
  SYSTEMS_MAPPING_SCALE_IDS,
  systemsMappingLevelTitle,
} from '../shared/systems-mapping-parts.js';
import './map-list-view.css';

const EMPTY_LIST = Object.freeze([]);
const LEVEL_ORDER = new Map(SYSTEMS_MAPPING_SCALE_IDS.map((scale, index) => [scale, index]));

function isRemoved(item) {
  return item?.status === 'rejected' || item?.claimState === 'retired';
}

function hasEvidence(item) {
  if (String(item?.evidence || '').trim() || String(item?.evidenceExcerpt || '').trim()) return true;
  return Array.isArray(item?.evidenceRefs) && item.evidenceRefs.some((reference) => (
    String(reference?.evidence || '').trim() || String(reference?.evidenceExcerpt || '').trim()
  ));
}

export function mapItemEvidenceStatus(item) {
  if (isRemoved(item)) return 'Removed';
  if (item?.claimState === 'contested') return 'Evidence contested';
  if (item?.status === 'research lead' || item?.claimState === 'research lead') return 'Needs evidence';
  if (hasEvidence(item)) return 'Evidence added';
  if (item?.status === 'pending' || item?.claimState === 'inference') return 'Evidence to review';
  return 'No evidence added';
}

function readableType(value, fallback) {
  const type = String(value || fallback || '').trim();
  return type ? `${type.charAt(0).toLocaleUpperCase()}${type.slice(1)}` : 'Map item';
}

function itemLevelTitle(scale) {
  return systemsMappingLevelTitle(scale) || readableType(scale, 'Unassigned level');
}

function compareRecords(left, right) {
  const leftLevel = LEVEL_ORDER.get(left.scale) ?? Number.MAX_SAFE_INTEGER;
  const rightLevel = LEVEL_ORDER.get(right.scale) ?? Number.MAX_SAFE_INTEGER;
  if (leftLevel !== rightLevel) return leftLevel - rightLevel;
  const labelComparison = String(left.label || left.sourceLabel || '').localeCompare(String(right.label || right.sourceLabel || ''));
  return labelComparison || String(left.id || '').localeCompare(String(right.id || ''));
}

function scopeLabels(node, nodeById) {
  const ids = Array.isArray(node.scopeNodeIds)
    ? node.scopeNodeIds
    : Array.isArray(node.affectedNodeIds)
      ? node.affectedNodeIds
      : [];
  const labels = ids.map((id) => nodeById.get(id)?.label).filter(Boolean);
  if (labels.length) return labels;
  return (Array.isArray(node.scope) ? node.scope : [])
    .map((member) => typeof member === 'string' ? nodeById.get(member)?.label : member?.label)
    .filter(Boolean);
}

function visibleMapRecords(nodes, edges, visibleScale, showRemoved) {
  const liveNodes = nodes.filter((node) => showRemoved || !isRemoved(node));
  const liveEdges = edges.filter((edge) => showRemoved || !isRemoved(edge));
  if (!visibleScale || visibleScale === 'all') return { nodes: liveNodes, edges: liveEdges };

  const visibleEdges = liveEdges.filter((edge) => edge.scale === visibleScale);
  const contextNodeIds = new Set(visibleEdges.flatMap((edge) => [edge.source, edge.target]));
  liveNodes.forEach((node) => {
    if (node.scale !== visibleScale || !['meso', 'macrosphere'].includes(node.scale)) return;
    (node.scopeNodeIds || []).forEach((id) => contextNodeIds.add(id));
    (node.affectedNodeIds || []).forEach((id) => contextNodeIds.add(id));
    (node.scope || []).forEach((member) => contextNodeIds.add(typeof member === 'string' ? member : member?.id));
  });

  return {
    nodes: liveNodes.filter((node) => node.scale === visibleScale || contextNodeIds.has(node.id)),
    edges: visibleEdges,
  };
}

function RecordDetails({ level, type, evidenceStatus, extraTerm, extraValues }) {
  return <dl className="map-list-record__details">
    <div><dt>Level</dt><dd>{level}</dd></div>
    <div><dt>Type</dt><dd>{type}</dd></div>
    <div><dt>Evidence</dt><dd>{evidenceStatus}</dd></div>
    {extraValues?.length ? <div className="map-list-record__scope"><dt>{extraTerm}</dt><dd>{extraValues.join(', ')}</dd></div> : null}
  </dl>;
}

function NodeRecord({ node, nodeById, onSelect }) {
  const members = scopeLabels(node, nodeById);
  const extraTerm = node.scale === 'meso'
    ? 'Micro settings'
    : node.scale === 'macrosphere'
      ? 'Affected map elements'
      : null;
  const removed = isRemoved(node);
  return <li className={`map-list-record${removed ? ' is-removed' : ''}`}>
    <button
      type="button"
      className="map-list-record__button"
      onClick={() => onSelect?.('node', node.id, true)}
      aria-label={`Open details for ${node.label}`}
    >
      <span className="map-list-record__identity">
        <strong>{node.label}</strong>
        {removed ? <span className="map-list-record__removed">Removed</span> : null}
      </span>
      <RecordDetails
        level={itemLevelTitle(node.scale)}
        type={readableType(node.type, 'Map item')}
        evidenceStatus={mapItemEvidenceStatus(node)}
        extraTerm={extraTerm}
        extraValues={members}
      />
    </button>
  </li>;
}

function ConnectionRecord({ edge, nodeById, onSelect }) {
  const source = edge.sourceLabel || nodeById.get(edge.source)?.label || 'Unknown map item';
  const target = edge.targetLabel || nodeById.get(edge.target)?.label || 'Unknown map item';
  const removed = isRemoved(edge);
  return <li className={`map-list-record${removed ? ' is-removed' : ''}`}>
    <button
      type="button"
      className="map-list-record__button"
      onClick={() => onSelect?.('edge', edge.id, true)}
      aria-label={`Open details for ${source} ${edge.verb} ${target}`}
    >
      <span className="map-list-record__identity map-list-record__proposition">
        <span>{source}</span>
        <strong>{edge.verb}</strong>
        <span>{target}</span>
        {removed ? <span className="map-list-record__removed">Removed</span> : null}
      </span>
      <RecordDetails
        level={itemLevelTitle(edge.scale)}
        type="Connection"
        evidenceStatus={mapItemEvidenceStatus(edge)}
      />
    </button>
  </li>;
}

export default function MapListView({
  nodes = EMPTY_LIST,
  edges = EMPTY_LIST,
  visibleScale = 'all',
  showRemoved = false,
  onSelect,
}) {
  const nodeList = Array.isArray(nodes) ? nodes : EMPTY_LIST;
  const edgeList = Array.isArray(edges) ? edges : EMPTY_LIST;
  const nodeById = useMemo(() => new Map(nodeList.map((node) => [node.id, node])), [nodeList]);
  const visibleRecords = useMemo(
    () => visibleMapRecords(nodeList, edgeList, visibleScale, showRemoved),
    [edgeList, nodeList, showRemoved, visibleScale],
  );
  const groupedNodes = useMemo(() => {
    const groups = new Map();
    visibleRecords.nodes.toSorted(compareRecords).forEach((node) => {
      const group = groups.get(node.scale) || [];
      group.push(node);
      groups.set(node.scale, group);
    });
    return [...groups.entries()].toSorted(([left], [right]) => (
      (LEVEL_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) - (LEVEL_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, [visibleRecords.nodes]);
  const sortedEdges = useMemo(() => visibleRecords.edges.toSorted(compareRecords), [visibleRecords.edges]);
  const itemCount = visibleRecords.nodes.length + visibleRecords.edges.length;

  return <section className="map-list-view" aria-labelledby="map-list-view-title">
    <header className="map-list-view__header">
      <div>
        <h2 id="map-list-view-title">Map list</h2>
        <p>The same map items in a readable list. Choose an item to open its details.</p>
      </div>
      <span className="map-list-view__count" aria-label={`${itemCount} visible map items`}>{itemCount} shown</span>
    </header>

    {itemCount === 0 ? <p className="map-list-view__empty">No map items are visible at this level.</p> : null}

    {groupedNodes.map(([scale, grouped]) => {
      const level = SYSTEMS_MAPPING_LEVELS.find((candidate) => candidate.id === scale);
      const title = level?.title || itemLevelTitle(scale);
      const headingId = `map-list-${String(scale || 'unassigned').replace(/[^a-z0-9_-]/gi, '-')}`;
      return <section className="map-list-view__group" aria-labelledby={headingId} key={scale || 'unassigned'}>
        <h3 id={headingId}>{title}</h3>
        <ul className="map-list-view__records">
          {grouped.map((node) => <NodeRecord key={node.id} node={node} nodeById={nodeById} onSelect={onSelect} />)}
        </ul>
      </section>;
    })}

    {sortedEdges.length ? <section className="map-list-view__group map-list-view__connections" aria-labelledby="map-list-connections">
      <h3 id="map-list-connections">Connections</h3>
      <ul className="map-list-view__records">
        {sortedEdges.map((edge) => <ConnectionRecord key={edge.id} edge={edge} nodeById={nodeById} onSelect={onSelect} />)}
      </ul>
    </section> : null}
  </section>;
}

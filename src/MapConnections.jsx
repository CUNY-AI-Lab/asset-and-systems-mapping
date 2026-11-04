import React from 'react';
import { describeMapConnection } from './mapInsights.js';
import { systemsMappingLevelTitle } from '../shared/systems-mapping-parts.js';

export default function MapConnections({ nodeId, index, onFollow, onConnect, onScopeFollow, selectedScope, compact = false }) {
  const node = index.nodeById.get(nodeId);
  const links = index.byNode.get(nodeId) || [];
  const groups = new Map();
  links.forEach((link) => {
    const item = describeMapConnection(link, nodeId, index.nodeById);
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push({ ...item, key: link.id, scope: link.kind === 'condition' ? { source: link.source, target: link.target } : null });
  });
  return <>
    {node && onConnect && <button className="map-item-action node-connect-action" type="button" onClick={() => onConnect(nodeId)}>Connect from <em>{node.label}</em></button>}
    {links.length > 0 && <details className="map-connections" key={nodeId}>
    <summary>{compact ? 'Connected items' : <>Connections across map <span>{links.length}</span></>}</summary>
    <div className="map-connections__body">
      {!compact && <p>Follow a recorded connection to inspect its evidence and context.</p>}
      {[...groups].map(([group, items]) => <section key={group} aria-label={group}>
        <h3>{group}</h3>
        <ul>{items.map((item) => <li key={item.key}>
          <button type="button" aria-pressed={item.scope ? selectedScope?.source === item.scope.source && selectedScope?.target === item.scope.target : undefined} onClick={() => item.scope && onScopeFollow ? onScopeFollow(item.scope.source, item.scope.target) : onFollow(item.kind, item.id)}>
            <strong>{item.label}</strong><span>{systemsMappingLevelTitle(item.scale)}</span>
          </button>
        </li>)}</ul>
      </section>)}
    </div>
    </details>}
  </>;
}

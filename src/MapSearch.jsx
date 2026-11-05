import React, { useMemo, useRef, useState } from 'react';
import { systemsMappingLevelTitle } from '../shared/systems-mapping-parts.js';

export default function MapSearch({ nodes, onSelect }) {
  const [query, setQuery] = useState('');
  const disclosure = useRef(null);
  const input = useRef(null);
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? nodes.filter((node) => node.label.toLocaleLowerCase().includes(term)) : [];
  }, [nodes, query]);
  const close = () => {
    disclosure.current.open = false;
    disclosure.current.querySelector('summary').focus();
  };
  return <details ref={disclosure} className="map-search" onToggle={(event) => {
    if (event.currentTarget.open) input.current?.focus();
  }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <summary>Find a node</summary>
    <div className="map-search__panel" role="search" aria-label="Find map elements">
      <label htmlFor="map-search-input">Find map item</label>
      <input id="map-search-input" ref={input} type="search" value={query} placeholder="Enter part of a node name" onChange={(event) => setQuery(event.target.value)} />
      <p role="status">{query.trim() ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}${matches.length > 8 ? ' · Showing the first 8; refine your search.' : ''}` : 'Search by name. Results include every mapped level.'}</p>
      <ul>{matches.slice(0, 8).map((node) => <li key={node.id}><button type="button" onClick={() => {
        disclosure.current.open = false;
        onSelect('node', node.id);
      }}><strong>{node.label}</strong><span>{systemsMappingLevelTitle(node.scale)}</span></button></li>)}</ul>
    </div>
  </details>;
}

import React, { useEffect, useId, useRef } from 'react';
import { SCALES } from './domain.js';
import MapSearch from './MapSearch.jsx';
import { MapToolsResizeHandle, useMapToolsSize } from './MapToolsResize.jsx';

// Keep this popover outside the legacy toolbar's grid and field rules.
export default function MapTools({ open, onOpenChange, scales, scale, onScale,
  presentation, onPresentation, nodes, onSelect, onZoom, canZoomOut, canZoomIn,
  onAdd, onFit, onArrange, canArrange, onLegend, onFullscreen, fullscreen,
  hasRemoved, showRemoved, onShowRemoved }) {
  const menu = useRef(null);
  const panelId = useId();
  const size = useMapToolsSize();
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => {
      if (!menu.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, onOpenChange]);
  const run = (action) => { onOpenChange(false); action(); };
  return <details ref={menu} className="notebook-map-tools" open={open}
    onToggle={(event) => onOpenChange(event.currentTarget.open)}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault(); event.stopPropagation(); onOpenChange(false);
        menu.current.querySelector('summary')?.focus();
      }
    }}>
    <summary>Map tools</summary>
    <div id={panelId} className="notebook-tools-panel" style={{ '--map-tools-width': `${size.width}px` }}>
      <MapToolsResizeHandle panelId={panelId} {...size} />
      <div className="notebook-tools-body">
      <div className="map-tools-view" role="group" aria-label="Map presentation">
        <button type="button" aria-pressed={presentation === 'canvas'} onClick={() => run(() => onPresentation('canvas'))}>Canvas</button>
        <button type="button" aria-pressed={presentation === 'list'} onClick={() => run(() => onPresentation('list'))}>List</button>
      </div>
      {scales.length > 1 && <label className="map-tools-layer"><span>Layers</span>
        <select aria-label="Show map layer" value={scale} onChange={(event) => onScale(event.target.value)}>
          <option value="all">All levels</option>
          {scales.map((value) => <option key={value} value={value}>{SCALES[value].label}</option>)}
        </select>
      </label>}
      {presentation === 'canvas' && <div className="map-tools-zoom" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom out" disabled={!canZoomOut} onClick={() => onZoom(-0.15)}>−</button>
        <button type="button" onClick={() => run(onFit)}>Fit map</button>
        <button type="button" aria-label="Zoom in" disabled={!canZoomIn} onClick={() => onZoom(0.15)}>+</button>
      </div>}
      <div className="map-tools-commands">
        {onAdd && <button type="button" className="map-tools-add" onClick={() => run(onAdd)}>Add item</button>}
        <MapSearch nodes={nodes} onSelect={(kind, id) => run(() => onSelect(kind, id))} />
        {presentation === 'canvas' && <button type="button" disabled={!canArrange} onClick={() => run(onArrange)}>Arrange map</button>}
        {presentation === 'canvas' && <button type="button" onClick={() => run(onLegend)}>Map key</button>}
        {!fullscreen && <button type="button" onClick={() => run(onFullscreen)}>Full screen map</button>}
      </div>
      {hasRemoved && <label className="map-tools-removed"><input type="checkbox" checked={showRemoved} onChange={(event) => onShowRemoved(event.target.checked)} />Show removed items</label>}
      </div>
    </div>
  </details>;
}

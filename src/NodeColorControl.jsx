import React, { useId } from 'react';
import { NODE_COLORS, NODE_COLOR_PALETTE } from '../shared/node-colors.js';
import './node-colors.css';

export default function NodeColorControl({ color, onChange }) {
  const name = useId();
  const current = NODE_COLORS.includes(color) ? color : 'automatic';
  return <fieldset className="node-color-control" aria-label="Node color">
    <legend><span className="field__label">Color</span><span className="node-color-control__value">{NODE_COLOR_PALETTE[current]?.name || 'Automatic'}</span></legend>
    <div className="node-color-control__options">
      {['automatic', ...NODE_COLORS].map(value => {
        const label = value === 'automatic' ? 'Automatic' : NODE_COLOR_PALETTE[value].name;
        return <label className="node-color-control__option" key={value} title={label}>
          <input type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value === 'automatic' ? undefined : value)} />
          <span className="node-color-control__swatch" data-node-color={value === 'automatic' ? undefined : value} aria-hidden="true">{value === 'automatic' && <svg viewBox="0 0 20 20"><path d="M3 17L17 3" /></svg>}</span>
          <span className="sr-only">{label}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}

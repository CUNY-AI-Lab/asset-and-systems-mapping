import React, { useState } from 'react';
import { NODE_TYPES, isNodeTypeAllowedAtScale } from './domain.js';

const SYSTEMS = { micro: 'Microsystem', exosphere: 'Exosystem', macrosphere: 'Macrosystem' };

export default function NodeClassificationEditor({ node, scales = Object.keys(SYSTEMS), onSave }) {
  const [scale, setScale] = useState(node.scale);
  const [type, setType] = useState(node.type);
  const [error, setError] = useState('');
  const changed = scale !== node.scale || type !== node.type;
  return <form className="node-classification" aria-label="Node classification" onSubmit={event => {
    event.preventDefault();
    if (!changed) return;
    setError(onSave(scale, type) || '');
  }}>
    <div className="node-classification__fields">
      <label className="field"><span className="field__label">System</span><select value={scale} onChange={event => {
        const next = event.target.value;
        setScale(next); setError('');
        if (!isNodeTypeAllowedAtScale(type, next)) setType(next === 'micro' ? 'role' : next === 'exosphere' ? 'institution' : 'policy');
      }}>{Object.entries(SYSTEMS).filter(([value]) => scales.includes(value) || value === node.scale).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span className="field__label">Type</span><select value={type} onChange={event => { setType(event.target.value); setError(''); }}>
        {NODE_TYPES.filter(value => isNodeTypeAllowedAtScale(value, scale)).map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
      </select></label>
    </div>
    {error && <p className="field__error" role="alert">{error}</p>}
    {changed && <div className="field-actions"><button type="submit" className="button button--secondary">Save classification</button><button type="button" className="button button--ghost" onClick={() => { setScale(node.scale); setType(node.type); setError(''); }}>Cancel</button></div>}
  </form>;
}

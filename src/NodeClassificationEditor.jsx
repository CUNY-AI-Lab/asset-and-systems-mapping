import React, { useState } from 'react';
import { nodeClassificationTypes } from './nodeClassification.js';

const SYSTEMS = { micro: 'Microsystem', exosphere: 'Exosystem', macrosphere: 'Macrosystem' };

export default function NodeClassificationEditor({ node, scales = Object.keys(SYSTEMS), onSave }) {
  const [scale, setScale] = useState(node.scale);
  const [type, setType] = useState(node.type);
  const [error, setError] = useState('');
  const changed = scale !== node.scale || type !== node.type;
  const types = nodeClassificationTypes(scale);
  const retainedLegacyType = scale === node.scale && type === node.type && !types.includes(type);
  return <form className="node-classification" aria-label="Node classification" onSubmit={event => {
    event.preventDefault();
    if (!changed) return;
    setError(onSave(scale, type) || '');
  }}>
    <div className="node-classification__fields">
      <label className="field"><span className="field__label">System</span><select value={scale} onChange={event => {
        const next = event.target.value;
        setScale(next); setError('');
        if (!nodeClassificationTypes(next).includes(type)) setType(next === 'micro' ? 'role' : next === 'exosphere' ? 'institution' : 'policy');
      }}>{Object.entries(SYSTEMS).filter(([value]) => scales.includes(value) || value === node.scale).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span className="field__label">Type</span><select value={type} onChange={event => { setType(event.target.value); setError(''); }}>
        {retainedLegacyType && <option value={type} disabled>{type[0].toUpperCase() + type.slice(1)} (current)</option>}
        {types.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
      </select></label>
    </div>
    {error && <p className="field__error" role="alert">{error}</p>}
    {changed && <div className="field-actions"><button type="submit" className="button button--secondary">Save classification</button><button type="button" className="button button--ghost" onClick={() => { setScale(node.scale); setType(node.type); setError(''); }}>Cancel</button></div>}
  </form>;
}

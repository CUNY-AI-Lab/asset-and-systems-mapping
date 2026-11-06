import React, {useId, useState} from 'react';
import './map-download.css';

const formats = [
  ['png','Map image (PNG)'], ['pdf','Printable map (PDF)'], ['svg','Scalable map (SVG)'],
  ['json','Private project backup (JSON)'], ['csv','Map data (CSV)'], ['markdown','Memos and notes (Markdown)'],
];
export default function MapDownloadControls({onDownload, hasMap=true, copies=false, disabled=false, onBusy}) {
  const [format,setFormat]=useState(hasMap ? 'png' : 'json');
  const [copy,setCopy]=useState('account');
  const [state,setState]=useState({busy:false});
  const id=useId(), locked=disabled || state.busy;
  const submit=async event=>{
    event.preventDefault();
    if(locked)return;
    setState({busy:true}); onBusy?.(true);
    try {
      await (copies ? onDownload(format,copy) : onDownload(format));
      setState({busy:false,message:format==='json'?'Private backup downloaded.':'Download started.'});
    } catch(error) {setState({busy:false,error:error?.message || 'Could not download this file. Try again.'});}
    finally {onBusy?.(false);}
  };
  return <form className="map-download" onSubmit={submit}>
    <div className={copies ? 'map-download__fields map-download__fields--copies' : 'map-download__fields'}>
      {copies && <label className="map-download__field">Saved copy<select value={copy} disabled={locked} onChange={e=>{setCopy(e.target.value);setState({busy:false});}}>
        <option value="account">Account copy</option><option value="device">Device copy</option>
      </select></label>}
      <label className="map-download__field">File format<select value={format} disabled={locked} aria-describedby={['json','markdown'].includes(format)?id:undefined} onChange={e=>{setFormat(e.target.value);setState({busy:false});}}>
        {formats.filter(([key])=>hasMap || !['png','pdf','svg'].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select></label>
      <button type="submit" className="button map-download__submit" disabled={locked}>{state.busy?'Preparing…':'Download'}</button>
    </div>
    {['json','markdown'].includes(format) && <small id={id}>Includes your memos and notes.</small>}
    {state.error && <p role="alert">{state.error}</p>}{(state.message || state.busy) && <span role="status" className="map-download__status">{state.message || 'Preparing file…'}</span>}
  </form>;
}

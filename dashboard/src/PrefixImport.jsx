import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {Badge} from './ui.jsx';
export default function PrefixImport({customers,onImported}) {
  const [file,setFile]=useState(null);
  const [customer,setCustomer]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState(null);
  const [reload,setReload]=useState(null);
  const input=useRef(null);
  useEffect(()=>{
    if(!result?.reload_id)return;
    let alive=true;let timer;
    async function poll(){
      try{const status=await api('/api/reload-status?id='+result.reload_id);if(!alive)return;setReload(status);if(!['success','failed'].includes(status.status))timer=setTimeout(poll,1000);}
      catch(e){if(alive){setReload({status:'unavailable',message:'Prefixes were saved, but reload status could not be checked: '+e.message});timer=setTimeout(poll,3000);}}
    }
    poll();return()=>{alive=false;clearTimeout(timer);};
  },[result?.reload_id]);
  async function upload(event) {
    event.preventDefault();setError('');setResult(null);setReload(null);
    if(!file){setError('Choose a CSV file first.');return;}
    if(file.size>1048576){setError('CSV files must be at most 1 MiB.');return;}
    setBusy(true);
    try {
      const query=customer?'?customer_id='+encodeURIComponent(customer):'';
      const response=await fetch('/api/rules/prefixes/import'+query,{method:'POST',headers:{'Content-Type':'text/csv'},body:await file.text()});
      const data=await response.json().catch(()=>({error:'CSV import failed'}));
      if(response.status===401)window.dispatchEvent(new Event('sipshield-unauthorized'));
      if(!response.ok)throw new Error(data.error||'CSV import failed');
      setResult(data);setReload(data.reload_id?{status:'queued',message:'Runtime update queued.'}:null);
      setFile(null);input.current.value='';
      onImported();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="prefix-import">
    <div className="section-heading"><div><h3>Import destination prefixes</h3><p>Add a CSV list instead of entering rules one by one.</p></div><a className="csv-template" href="/destination-prefixes-template.csv" download>Download CSV template</a></div>
    <p className="muted">Use a <code>prefix</code> column and an optional <code>reason</code> column. Keep spreadsheet prefixes as text so leading zeros and + signs are preserved. Maximum 1,000 records / 1 MiB.</p>
    <form onSubmit={upload}><div className="fields"><label>Prefix CSV file<input ref={input} type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>{setFile(e.target.files[0]??null);setError('');}}/></label><label>CSV import scope<select value={customer} disabled={busy} onChange={e=>setCustomer(e.target.value)}><option value="">Global — all customers</option>{customers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label></div><button disabled={busy||!file}>{busy?'Importing…':'Import CSV'}</button></form>
    <p className="muted">Every record must be valid; otherwise nothing is imported. Duplicates in this file or existing rules in the selected scope are skipped; existing reasons stay unchanged.</p>
    {error&&<div className="error" role="alert">{error}</div>}
    {result&&<div className="notice" role="status">Imported {result.imported} prefixes; skipped {result.skipped} duplicates. {result.message}</div>}
    {reload&&<div className={`prefix-import-status ${reload.status==='failed'?'error':''}`} role="status"><Badge value={reload.status}/><span>{reload.status==='success'?'Imported prefixes are active.':reload.status==='failed'?'Runtime update failed; imported rules remain saved. Fix the reported issue and click Apply SIP Config.':reload.message}</span>{reload.error&&<pre>{reload.error}</pre>}{reload.status==='failed'&&<p>{reload.message}</p>}</div>}
  </div>;
}

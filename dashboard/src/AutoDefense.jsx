import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Badge } from './ui.jsx';
const initial = {name:'',enabled:true,metric:'register',threshold:30,window_seconds:60,block_seconds:1800,action:'alert_only',customer_id:null};
export default function AutoDefense({customers}) {
  const [rules,setRules]=useState([]), [events,setEvents]=useState([]);
  const [form,setForm]=useState(initial), [editId,setEditId]=useState(null);
  const [error,setError]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false);
  async function refresh() {
    const [r,e]=await Promise.all([api('/api/behavior-rules'),api('/api/auto-defense/events')]);
    setRules(r); setEvents(e);
  }
  useEffect(()=>{refresh().catch(e=>setError(e.message)); const timer=setInterval(()=>refresh().catch(()=>{}),5000);return()=>clearInterval(timer);},[]);
  async function change(task) {
    setBusy(true);setError('');setNotice('');
    try {await task();await refresh();setNotice('Saved. Runtime update queued; check the reload status above.');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <>
    <p>Temporary bans protect against request bursts and repeated backend failures. Start new rules in alert-only mode and check real traffic before enabling blocking. Counters run inside Kamailio.</p>
    <p>Trusted carriers: add an IP/CIDR with policy <strong>Allow</strong> in Rules. Global allows bypass Auto Defense for all customers; customer allows bypass it for that customer, including existing temporary bans and Pike.</p>
    {error&&<div role="alert" className="error">{error}</div>}{notice&&<div role="status" className="notice">{notice}</div>}
    <section><h2>{editId?'Edit behavior rule':'Add behavior rule'}</h2>
      <form onSubmit={e=>{e.preventDefault();change(async()=>{await api(`/api/behavior-rules${editId?`/${editId}`:''}`,editId?'PUT':'POST',form);setForm(initial);setEditId(null);});}}>
        <div className="fields">
          <label>Name<input required maxLength={512} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
          <label>Metric<select value={form.metric} onChange={e=>setForm({...form,metric:e.target.value})}>{['invite','register','options','response_404','response_403'].map(m=><option key={m}>{m}</option>)}</select></label>
          {['threshold','window_seconds','block_seconds'].map(key=><label key={key}>{key.replaceAll('_',' ')}<input required type="number" min={1} max={key==='threshold'?100000:key==='window_seconds'?3600:86400} value={form[key]} onChange={e=>setForm({...form,[key]:Number(e.target.value)})}/></label>)}
          <label>Action<select value={form.action} onChange={e=>setForm({...form,action:e.target.value})}><option value="alert_only">Alert only (would_block)</option><option value="block">Temporary block</option></select></label>
          <label>Customer<select value={form.customer_id??''} onChange={e=>setForm({...form,customer_id:e.target.value?Number(e.target.value):null})}><option value="">Global</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Enabled</label>
        </div><button disabled={busy}>Save rule</button>{editId&&<button type="button" onClick={()=>{setEditId(null);setForm(initial);}}>Cancel</button>}
      </form>
    </section>
    <section><h2>Behavior rules</h2><div className="table-wrap"><table><thead><tr>{['Name','Enabled','Metric','Threshold','Window (s)','Ban (s)','Action','Customer','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rules.map(r=><tr key={r.id}><td>{r.name}</td><td><Badge value={r.enabled}/></td><td>{r.metric}</td><td>{r.threshold}</td><td>{r.window_seconds}</td><td>{r.block_seconds}</td><td><Badge value={r.action}/></td><td>{customers.find(c=>c.id===r.customer_id)?.name??'Global'}</td><td><button onClick={()=>{setEditId(r.id);setForm(r);}}>Edit</button> <button disabled={busy} className="danger" onClick={()=>{if(window.confirm('Delete this behavior rule?'))change(()=>api(`/api/behavior-rules/${r.id}`,'DELETE'));}}>Delete</button></td></tr>)}</tbody></table></div></section>
    <section><h2>Recent auto-blocks and alerts</h2><div className="table-wrap"><table><thead><tr>{['Time','Source IP','Method','Response','Action','Reason','Threshold','Window (s)','Ban (s)'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{new Date(e.created_at).toLocaleString()}</td>{['source_ip','method','response_code','action','reason','threshold','window_seconds','block_seconds'].map(k=><td key={k}>{e[k]??'—'}</td>)}</tr>)}</tbody></table>{events.length===0&&<p>No Auto Defense events yet.</p>}</div></section>
  </>;
}

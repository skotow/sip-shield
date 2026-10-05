import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Badge, Icon } from './ui.jsx';
const shown=['created_at','customer_id','source_ip','source_port','transport','method','call_id','from_user','from_domain','to_user','to_domain','request_uri','called_number','caller_id','user_agent','backend_host','backend_port','response_code','response_reason','action','reason','asn','asn_name','country'];
const display=value=>value==null||value===''||value==='<null>'?'Unknown':String(value);
function localDate(date) { return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function initialFilters() { const now=new Date();return {date_from:localDate(new Date(now-86400000)),date_to:'',customer_id:'',source_ip:'',called_number:'',caller_id:'',backend_host:'',method:'',response_code:'',action:'',user_agent:'',asn:'',country:'',call_id:''}; }
function params(filters,offset,limit=100) {
  const query=new URLSearchParams({limit:String(limit),offset:String(offset)});
  for(const [key,value] of Object.entries(filters)) if(value!=='')query.set(key,key.startsWith('date_')?new Date(value).toISOString():value);
  return query;
}
function Details({event,onClose}) {
  const dialog=useRef(null);
  useEffect(()=>{dialog.current.showModal();},[]);
  return <dialog className="explorer-dialog" ref={dialog} onCancel={onClose} onClick={e=>{if(e.target===dialog.current)onClose();}}><div className="section-heading"><div><p className="eyebrow">SECURITY EVENT #{event.id}</p><h2>Traffic details</h2></div><button autoFocus onClick={onClose} aria-label="Close traffic details">Close</button></div><p className="muted">Socket-observed source and SIP metadata. SIP identity fields are sender claims.</p><dl className="explorer-details">{shown.map(key=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{key==='action'?<Badge value={event[key]}/>:key==='created_at'?new Date(event[key]).toLocaleString():display(event[key])}</dd></div>)}</dl></dialog>;
}
export default function SIPExplorer({customers,refreshToken=0}) {
  const [filters,setFilters]=useState(initialFilters);
  const [applied,setApplied]=useState(initialFilters);
  const [data,setData]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState(null);
  const [exporting,setExporting]=useState(false);
  const sequence=useRef(0);
  async function search(next,offset=0) {
    const version=++sequence.current;setBusy(true);setError('');
    try { const result=await api('/api/sip-events/search?'+params(next,offset));if(sequence.current===version){setData(result);setApplied(next);} }
    catch(e){if(sequence.current===version)setError(e.message);}
    finally {if(sequence.current===version)setBusy(false);}
  }
  useEffect(()=>{search(refreshToken===0?filters:applied);return()=>{sequence.current++;};},[refreshToken]);
  async function exportCsv() {
    setExporting(true);setError('');
    try {
      const query=params(applied,data.offset,data.limit);query.set('format','csv');
      const response=await fetch('/api/sip-events/search?'+query,{credentials:'same-origin'});
      if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('sipshield-unauthorized'));throw new Error((await response.json()).error||'Export failed');}
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='sip-explorer.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e.message);}finally{setExporting(false);}
  }
  const summary=data?.summary;
  const field=(key,label,options)=> <label key={key}>{label}{options?<select value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})}><option value="">All</option>{options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select>:<input type={key.startsWith('date_')?'datetime-local':'text'} required={key==='date_from'} maxLength={512} value={filters[key]} placeholder={key==='source_ip'?'Exact IP address':key==='country'?'e.g. US':undefined} onChange={e=>setFilters({...filters,[key]:e.target.value})}/>}</label>;
  return <div className="sip-explorer">
    <section><div className="section-heading"><div><h2>Traffic search</h2><p>Find who sent traffic, where it went, and what happened.</p></div><span className="subtle-tag">Security metadata</span></div>
      <form onSubmit={e=>{e.preventDefault();search(filters);}}><div className="explorer-filters">
        {field('date_from','From (local time)')}{field('date_to','To (blank = now)')}{field('customer_id','Customer',customers.map(c=>[String(c.id),c.name]))}{field('source_ip','Source IP')}
        {field('called_number','Called number')}{field('caller_id','Caller ID')}{field('backend_host','Backend host')}{field('call_id','Call-ID')}
        {field('method','Method',[['INVITE','INVITE'],['REGISTER','REGISTER'],['OPTIONS','OPTIONS'],['ACK','ACK'],['BYE','BYE'],['CANCEL','CANCEL'],['SUBSCRIBE','SUBSCRIBE'],['NOTIFY','NOTIFY'],['MESSAGE','MESSAGE'],['INFO','INFO'],['UPDATE','UPDATE'],['PRACK','PRACK'],['REFER','REFER'],['PUBLISH','PUBLISH']])}{field('response_code','Response code')}{field('action','Decision',[['allowed','Allowed'],['blocked','Blocked'],['would_block','Would block']])}{field('user_agent','User-Agent contains')}
        {field('asn','ASN')}{field('country','Country code')}
      </div><div className="explorer-controls"><button className="primary" disabled={busy}><Icon name="SIP Explorer" size={17}/>{busy?'Searching…':'Search traffic'}</button><button type="button" disabled={busy} onClick={()=>{const next=initialFilters();setFilters(next);search(next);}}>Last 24 hours / Reset</button><span className="muted">Up to 31 days · exact matches except User-Agent</span></div></form>
    </section>
    {error&&<div role="alert" className="error">{error}</div>}
    <div className="explorer-summary" aria-busy={busy}>{[['Total events',summary?.total_events],['Allowed',summary?.allowed],['Blocked',summary?.blocked],['Top source IP',summary?.top_source_ip],['Top called number',summary?.top_called_number],['Top response code',summary?.top_response_code]].map(([label,value])=><section key={label}><span>{label}</span><strong title={display(value)}>{value==null?'—':typeof value==='number'?value.toLocaleString():value}</strong></section>)}</div>
    <section><div className="section-heading"><div><h2>Search results</h2><p>{data?`${data.summary.total_events.toLocaleString()} events match the applied filters`:'Loading traffic…'}</p></div><button disabled={!data||!data.events.length||busy||exporting} onClick={exportCsv}>{exporting?'Exporting…':'Export page CSV'}</button></div>
      <div className="table-wrap" aria-busy={busy}><table><thead><tr>{['Time','Source / transport','Method / Call-ID','Caller → called','Backend','Response','Decision','Details'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{data?.events.map(event=><tr key={event.id}><td className="timestamp">{new Date(event.created_at).toLocaleString()}</td><td><span className="mono">{display(event.source_ip)}{event.source_port?':'+event.source_port:''}</span><small className="explorer-subline">{display(event.transport)}</small></td><td>{display(event.method)}<small className="explorer-subline mono" title={event.call_id}>{display(event.call_id)}</small></td><td>{display(event.caller_id??event.from_user)} → {display(event.called_number??event.to_user)}<small className="explorer-subline">{display(event.to_domain)}</small></td><td>{display(event.backend_host)}{event.backend_port?':'+event.backend_port:''}</td><td>{event.response_code??'—'}<small className="explorer-subline">{event.response_reason??''}</small></td><td><Badge value={event.action}/><small className="explorer-subline">{display(event.reason).replaceAll('_',' ')}</small></td><td><button onClick={()=>setSelected(event)}>View details</button></td></tr>)}</tbody></table>{data&&!data.events.length&&<div className="empty"><Icon name="SIP Explorer" size={26}/><strong>No matching traffic</strong><span>Try a wider date range or fewer filters.</span></div>}</div>
      {data&&<div className="explorer-pagination"><span>{data.events.length?data.offset+1:0}–{data.offset+data.events.length} of {data.summary.total_events.toLocaleString()}</span><div><button disabled={busy||data.offset===0} onClick={()=>search(applied,Math.max(0,data.offset-data.limit))}>Previous</button><button disabled={busy||data.offset+data.limit>=data.summary.total_events||data.offset+data.limit>100000} onClick={()=>search(applied,data.offset+data.limit)}>Next</button></div></div>}
      <p className="data-note">Individual request decisions and backend responses. Allowed means permitted by SIP Shield, even if the PBX replies with an error. ASN/country remain unknown without enrichment. No RTP or call-quality measurements.</p>
    </section>{selected&&<Details event={selected} onClose={()=>setSelected(null)}/>}
  </div>;
}

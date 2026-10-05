import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Badge, Icon } from './ui.jsx';
const endpoint=(m,side)=>m[side+'_role']==='gateway'?'gateway':`${m[side+'_ip']}:${m[side+'_port']} (${m.transport})`;
const label=m=>m.response_code?m.first_line.replace('SIP/2.0 ',''):m.first_line;
const time=value=>new Date(value).toLocaleTimeString(undefined,{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3});
function Ladder({messages,onSelect}) {
  const endpoints=[...new Set(messages.flatMap(m=>[endpoint(m,'source'),endpoint(m,'destination')]))];
  const rows=messages.slice(0,200), width=Math.max(750,160+endpoints.length*220), height=100+rows.length*74;
  const x=e=>180+endpoints.indexOf(e)*220;
  const start=messages.length?new Date(messages[0].captured_at).getTime():0;
  return <><p className="trace-help">Actual captured network hops · Select an arrow to inspect its message. Times are relative to the first captured message.</p>{messages.length>200&&<p className="banner">Diagram shows the first 200 messages. The Messages tab shows all returned messages.</p>}<div className="ladder-scroll"><svg className="ladder" width={width} height={height} role="group" aria-label="SIP signaling ladder diagram">
    <defs>{['request','reply','failure'].map(kind=><marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" className={kind}/></marker>)}</defs>
    <text x="16" y="30" className="lane-title">TIME / ELAPSED</text>
    {endpoints.map(e=><g key={e}><text x={x(e)} y="30" textAnchor="middle" className="lane-title">{e==='gateway'?'SIP Shield':e.split(' (')[0]}</text><text x={x(e)} y="48" textAnchor="middle" className="lane-subtitle">{e==='gateway'?'Observed gateway sockets':e.split(' (')[1]?.replace(')','')}</text><line x1={x(e)} y1="65" x2={x(e)} y2={height-15} className="lifeline"/></g>)}
    {rows.map((m,i)=>{const y=94+i*74,from=x(endpoint(m,'source')),to=x(endpoint(m,'destination')),kind=!m.response_code?'request':m.response_code>=400?'failure':'reply';const text=m.response_code?label(m):`${m.method} ${m.first_line.split(' ')[1]||''}`;const max=Math.max(22,Math.floor(Math.abs(to-from)/5.5)-3);return <g key={m.id} className="flow-message" role="button" tabIndex={0} aria-label={`Inspect ${label(m)}`} onClick={()=>onSelect(m)} onKeyDown={e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();onSelect(m);}}}>
      <title>{label(m)}</title>
      <rect x="0" y={y-25} width={width} height="65" fill="transparent"/>
      <text x="16" y={y-4} className="flow-time">{time(m.captured_at)}</text><text x="16" y={y+14} className="lane-subtitle">+{((new Date(m.captured_at).getTime()-start)/1000).toFixed(3)}s</text>
      <line x1={from} y1={y} x2={to} y2={y} className={`flow-line ${kind}`} markerEnd={`url(#arrow-${kind})`}/>
      <text x={(from+to)/2} y={y-8} textAnchor="middle" className={`flow-label ${kind}`}>{text.length>max?text.slice(0,max-1)+'…':text}</text><text x={(from+to)/2} y={y+19} textAnchor="middle" className="lane-subtitle">CSeq {m.cseq} · {m.size_bytes} bytes · {m.transport}</text>
    </g>;})}
  </svg></div></>;
}
export default function EventDetails({eventId,onClose}) {
  const dialog=useRef(null), [data,setData]=useState(null), [error,setError]=useState('');
  const [tab,setTab]=useState('Diagram'), [selected,setSelected]=useState(null);
  useEffect(()=>{dialog.current.showModal();const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=old;};},[]);
  useEffect(()=>{let live=true;const load=()=>api(`/api/events/${eventId}`).then(value=>{if(live){setData(value);setError('');setSelected(previous=>value.messages.find(m=>m.id===previous?.id)||value.messages[0]||null);}}).catch(e=>{if(live)setError(e.message);});load();const timer=setInterval(load,3000);return()=>{live=false;clearInterval(timer);};},[eventId]);
  const event=data?.event;
  const methods=[...new Set([...(data?.decisions||[]).map(d=>d.method),...(data?.messages||[]).map(m=>m.method)])].filter(Boolean);
  return <dialog ref={dialog} className="trace-dialog" aria-labelledby="trace-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current)onClose();}}><div className="trace-shell">
    <div className="trace-header"><div><p className="eyebrow">SIGNALING EXPLORER</p><h2 id="trace-title">SIP event details</h2></div><button aria-label="Close event details" onClick={onClose}>Close</button></div>
    {error&&<div role="alert" className="error">{error}</div>}
    {!data&&!error&&<p className="trace-help">Loading signaling…</p>}
    {event&&<><div className="trace-summary"><div><small>Decision</small><Badge value={event.action}/></div><div><small>Method</small><strong>{event.method||'—'}</strong></div><div><small>Source</small><strong className="mono">{event.source_ip||'—'}</strong></div><div><small>Reason</small><strong>{event.reason?.replaceAll('_',' ')||'—'}</strong></div></div><div className="call-id"><span>CALL-ID</span><code>{event.call_id||'Not recorded for this event'}</code></div>
    <div className="trace-tabs" role="tablist" aria-label="Signaling views">{['Diagram','Messages','Decisions'].map(t=><button id={`trace-tab-${t}`} role="tab" aria-selected={tab===t} aria-controls="trace-panel" key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}{t==='Messages'&&<span>{data.messages.length}</span>}</button>)}<span className="trace-live"><span/>Refreshes every 3s</span></div>
    <div id="trace-panel" role="tabpanel" aria-labelledby={`trace-tab-${tab}`} className="trace-content">
    <div className="session-methods"><span>Methods in this session</span>{methods.map(method=><span className="subtle-tag" key={method}>{method}</span>)}<span>{data.decisions.length}{data.decisions_truncated?'+':''} decisions</span></div>
    {data.decisions_truncated&&<div className="banner">Decisions show the earliest 500 entries for this Call-ID.</div>}
    {data.truncated&&<div className="banner">Capture contains more messages. This view is limited to the earliest 500 within 24 hours of the event.</div>}
    {tab!=='Decisions'&&!data.messages.length&&<div className="empty"><Icon name="Events" size={30}/><strong>No signaling captured for this event</strong><span>Historical events have decisions only. New traffic is captured after signaling capture was enabled; ingestion may take a few seconds.</span></div>}
    {tab==='Diagram'&&data.messages.length>0&&<Ladder messages={data.messages} onSelect={m=>{setSelected(m);setTab('Messages');}}/>}
    {tab==='Messages'&&data.messages.length>0&&<><p className="trace-help">Authentication and unknown headers are redacted; message bodies are omitted. This is a sanitized signaling view.</p><div className="message-workspace"><div className="message-list" aria-label="Captured messages">{data.messages.map(m=><button key={m.id} className={selected?.id===m.id?'selected':''} onClick={()=>setSelected(m)}><span>{time(m.captured_at)} <b>{m.response_code||m.method}</b></span><strong>{label(m).slice(0,90)}</strong><small>{endpoint(m,'source')} → {endpoint(m,'destination')}</small></button>)}</div>{selected&&<div className="message-inspector"><div className="message-meta"><Badge value={selected.response_code ? String(selected.response_code) + " response" : 'request'}/><span>{selected.transport.toUpperCase()} · {selected.size_bytes} captured bytes</span>{selected.truncated&&<span>Truncated display</span>}</div><pre tabIndex={0} aria-label="Sanitized SIP message">{selected.message}</pre></div>}</div></>}
    {tab==='Decisions'&&<div className="table-wrap"><table><thead><tr>{['Time','Source','Method','Decision','Reason'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.decisions.map(e=><tr key={e.id}><td>{time(e.created_at)}</td><td className="mono">{e.source_ip}</td><td>{e.method}</td><td><Badge value={e.action}/></td><td>{e.reason?.replaceAll('_',' ')}</td></tr>)}</tbody></table></div>}
    </div></>}
  </div></dialog>;
}

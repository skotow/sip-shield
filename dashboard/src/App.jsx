import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import Login from './Login.jsx';
import AutoDefense from './AutoDefense.jsx';
import EventDetails from './EventDetails.jsx';
import SIPExplorer from './SIPExplorer.jsx';
import { Icon, Badge } from './ui.jsx';
const tabs = ['Overview', 'Customers', 'Rules', 'Auto Defense', 'Events', 'SIP Explorer', 'Settings'];
const ruleTypes = [['blocked-ips', 'ip_cidr', 'Blocked IPs / CIDRs'], ['user-agents', 'pattern', 'User-Agent patterns'], ['prefixes', 'prefix', 'Destination prefixes']];
const emptyCustomer = { name: '', domain: '', backend_host: '', backend_port: 5060, enabled: true };
const descriptions = {
  Overview:'Your SIP gateway, at a glance.', Customers:'Manage customer domains and their backend destinations.',
  Rules:'Control which traffic reaches your SIP infrastructure.', 'Auto Defense':'Detect unusual traffic and respond with temporary protection.',
  Events:'Explore the decisions made by your SIP gateway.', Settings:'Manage integrations and notification preferences.',
  'SIP Explorer':'Search SIP traffic, security decisions, and backend responses.',
};
export default function App() {
  const [session,setSession]=useState(null);
  useEffect(()=>{api('/api/auth/session').then(()=>setSession(true)).catch(()=>setSession(false));const expire=()=>setSession(false);window.addEventListener('sipshield-unauthorized',expire);return()=>window.removeEventListener('sipshield-unauthorized',expire);},[]);
  if(session===null)return <div className="session-loading"><Icon name="shield" size={32}/><p>Connecting to your workspace…</p></div>;
  if(!session)return <Login onLogin={()=>setSession(true)} />;
  return <Dashboard onLogout={async()=>{await api('/api/auth/logout','POST',{});setSession(false);}} />;
}
function Table({ rows, columns, remove, edit, inspect }) {
  return <div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}{(remove || edit || inspect) && <th>Actions</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id ?? row.source_ip} className={inspect ? "inspectable-row" : undefined} onClick={inspect ? () => inspect(row) : undefined}>{columns.map(c => <td key={c}>{['enabled','action','policy'].includes(c)?<Badge value={row[c]}/>:['created_at','last_seen','first_seen'].includes(c) ? <span className="timestamp">{new Date(row[c]).toLocaleString()}</span> : <span className={['source_ip','domain','backend_host','method','call_id'].includes(c)?'mono':''}>{row[c] == null || row[c] === '<null>' ? '—' : c === 'reason' ? String(row[c]).replaceAll('_',' ') : String(row[c])}</span>}</td>)}{(remove || edit || inspect) && <td className="row-actions">{inspect && <button onClick={e => { e.stopPropagation(); inspect(row); }}>View signaling</button>}{edit && <button onClick={() => edit(row)}>Edit</button>} {remove && <button className="danger" onClick={() => remove(row)}>Delete</button>}</td>}</tr>)}</tbody></table>{rows.length === 0 && <div className="empty"><Icon name="Events" size={26}/><strong>Nothing here yet</strong><span>New records will appear here as you configure your gateway.</span></div>}</div>;
}
function Dashboard({onLogout}) {
  const [tab, setTab] = useState('Overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(null);
  const [eventSearch, setEventSearch] = useState('');
  const [explorerRefresh,setExplorerRefresh]=useState(0);
  const [stats, setStats] = useState({ allowed: 0, blocked: 0, top_sources: [] });
  const [rules, setRules] = useState({});
  const [health, setHealth] = useState('Connecting');
  const [form, setForm] = useState(emptyCustomer);
  const [editId, setEditId] = useState(null);
  const [settings, setSettings] = useState({ telegram_chat_id: '', telegram_token_configured: false });
  const [token, setToken] = useState('');
  const [applyState, setApplyState] = useState('idle');
  const [reloadStatus, setReloadStatus] = useState({ status: 'idle', message: 'Checking reload status' });
  const [requestedId, setRequestedId] = useState(null);
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const status = await api(requestedId ? `/api/reload-status?id=${requestedId}` : '/api/reload-status');
        if (!alive) return;
        setReloadStatus(status);
        if (requestedId && status.id !== requestedId) return;
        if (['queued', 'validating', 'activating'].includes(status.status)) setApplyState(previous => previous === 'generating' ? previous : 'waiting reload');
        else if (['success', 'failed'].includes(status.status)) { setApplyState(previous => ['generating', 'failed'].includes(previous) ? previous : status.status); setRequestedId(null); }
      } catch (e) { if (alive) setReloadStatus({ status: 'unavailable', message: e.message }); }
    }
    poll();
    const timer = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [requestedId]);
  async function applyConfig() {
    setApplyState('generating'); setError(''); setNotice('');
    try {
      const result = await api('/api/apply-config', 'POST', { requested_by: 'dashboard' });
      setRequestedId(result.id); setApplyState('waiting reload');
      setReloadStatus({ ...result, message: result.message });
    } catch (e) { setApplyState('failed'); setError(e.message); }
  }
  async function refresh() {
    const [c, e, s, h, a, ...r] = await Promise.all([api('/api/customers'), api('/api/event-sessions'), api('/api/stats'), api('/health'), api('/api/settings'), ...ruleTypes.map(([p]) => api(`/api/rules/${p}`))]);
    setCustomers(c); setEvents(e); setStats(s); setHealth(h.status); setSettings(a);
    setRules(Object.fromEntries(ruleTypes.map(([p], i) => [p, r[i]])));
  }
  useEffect(() => { refresh().catch(e => { setError(e.message); setHealth('Unavailable'); }); const timer=setInterval(()=>refresh().catch(()=>{}),5000); return ()=>clearInterval(timer); }, []);
  async function run(task) {
    setBusy(true); setError(''); setNotice('');
    try { await task(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const remove = (path, row) => { if (window.confirm('Delete this record? Customer deletion also deletes its rules.')) run(() => api(`${path}/${row.id}`, 'DELETE')); };
  const eventTable = <Table inspect={row => setEventId(row.id)} rows={tab === 'Overview' ? events.slice(0, 10) : events.filter(e => [e.call_id,e.source_ip,e.methods?.join(' '),e.from_user,e.to_user,e.action,e.reason].some(value => String(value ?? '').toLowerCase().includes(eventSearch.toLowerCase())))} columns={['last_seen','source_ip','from_user','to_user','call_id','decision_count']} />;
  const total=stats.allowed+stats.blocked;
  const allowedPercent=total?Math.round(stats.allowed/total*100):0;
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="shield" size={23}/></span>SIP Shield</div>
      <div className="workspace"><span className="workspace-avatar">S</span><div><strong>Gateway workspace</strong><small>Self-hosted instance</small></div><span className="workspace-dot"/></div>
      <p className="nav-label">WORKSPACE</p><nav aria-label="Main navigation">{tabs.map(t=><button className={t===tab?'active':''} key={t} onClick={()=>setTab(t)} aria-current={t===tab?'page':undefined}><Icon name={t}/><span>{t}</span>{t==='Events'&&events.length>0&&<span className="nav-count">{events.length}</span>}</button>)}</nav>
      <div className="sidebar-footer"><div className="connection"><span className={`connection-dot ${health==='ok'?'online':''}`}/><div><strong>{health==='ok'?'Management connected':health}</strong><small>Self-hosted control plane</small></div></div><button className="account-button" aria-label="Sign out" onClick={onLogout}><span className="account-avatar">A</span><span><strong>Administrator</strong><small>Sign out of workspace</small></span><Icon name="logout" size={18}/></button></div>
    </aside>
    <main><div className="topbar"><span>Workspace <span className="breadcrumb-separator">/</span> <strong>{tab}</strong></span><span className="environment-tag"><span/>Self-hosted</span></div>
    <header><div><p className="eyebrow">SIP GATEWAY MANAGEMENT</p><h1>{tab}</h1><p className="page-description">{descriptions[tab]}</p></div><div className="header-actions"><button className="refresh-button" disabled={busy} onClick={()=>run(async()=>{if(tab==='SIP Explorer')setExplorerRefresh(value=>value+1);})}><Icon name="refresh" size={17}/>Refresh</button><button className="primary" disabled={busy||['generating','waiting reload'].includes(applyState)} onClick={applyConfig}><Icon name="check" size={17}/>{applyState==='generating'?'Preparing…':applyState==='waiting reload'?'Applying…':'Apply SIP Config'}</button></div></header>
    {error&&<div role="alert" className="error">{error}</div>}{notice&&<div role="status" className="notice">{notice}</div>}
    <div className={`config-status ${reloadStatus.status==='failed'?'has-error':''}`} role="status"><span className="config-icon"><Icon name={reloadStatus.status==='success'?'check':'Rules'} size={18}/></span><div className="config-copy"><strong>{reloadStatus.status==='success'?'Configuration applied':reloadStatus.status==='failed'?'Configuration needs attention':['queued','activating'].includes(reloadStatus.status)?'Applying configuration':'Configuration status'}</strong><span>{reloadStatus.status==='success'?'Runtime rules are active. SIP forwarding continues without a restart.':reloadStatus.message}</span></div><Badge value={reloadStatus.status}/><details><summary>Details</summary><div className="config-details"><p>{reloadStatus.message}</p>{reloadStatus.id&&<p>Request <code>{reloadStatus.id}</code></p>}{reloadStatus.finished_at&&<p>Finished {new Date(reloadStatus.finished_at).toLocaleString()}</p>}{reloadStatus.warnings?.map((warning,i)=><p key={i}>{warning}</p>)}{reloadStatus.error&&<pre>{reloadStatus.error}</pre>}</div></details></div>
    {tab==='Overview'&&<>
      <div className="cards">{[{label:'Allowed requests',value:stats.allowed,icon:'check',tone:'green',note:'Accepted by your gateway'},{label:'Blocked requests',value:stats.blocked,icon:'shield',tone:'rose',note:'Rejected by security policies'},{label:'Customers',value:customers.length,icon:'Customers',tone:'indigo',note:`${customers.filter(c=>c.enabled).length} enabled destinations`}].map(card=><section className="metric-card" key={card.label}><div className="metric-heading"><span>{card.label}</span><span className={`metric-icon ${card.tone}`}><Icon name={card.icon}/></span></div><strong>{card.value.toLocaleString()}</strong><p>{card.note}</p></section>)}</div>
      <div className="overview-grid"><section><div className="section-heading"><div><h2>Traffic decisions</h2><p>All collected allowed and blocked decisions</p></div><Icon name="Events"/></div><div className="traffic-total"><strong>{total.toLocaleString()}</strong><span>Total decisions</span></div><div className="traffic-meter" aria-label={`${stats.allowed} allowed and ${stats.blocked} blocked requests`}><span style={{width:`${total?stats.allowed/total*100:0}%`}}/><span style={{width:`${total?stats.blocked/total*100:0}%`}}/></div><div className="traffic-legend"><span><i className="legend-dot green"/>Allowed <strong>{allowedPercent}%</strong></span><span><i className="legend-dot rose"/>Blocked <strong>{total?100-allowedPercent:0}%</strong></span></div></section>
      <section><div className="section-heading"><div><h2>Top sources</h2><p>Most active IPs across collected events</p></div><span className="subtle-tag">Top 5</span></div><div className="source-list">{stats.top_sources.map(source=><div className="source-row" key={source.source_ip}><div><span className="mono">{source.source_ip}</span><strong>{source.requests.toLocaleString()} <small>requests</small></strong></div><div className="source-track"><span style={{width:`${source.requests/Math.max(...stats.top_sources.map(s=>s.requests),1)*100}%`}}/></div></div>)}{!stats.top_sources.length&&<p className="muted">Sources will appear when SIP traffic is collected.</p>}</div></section></div>
      <section><div className="section-heading"><div><h2>Recent activity</h2><p>Latest signaling sessions from your SIP gateway</p></div><button className="text-button" onClick={()=>setTab('Events')}>View all events <Icon name="arrow" size={16}/></button></div>{eventTable}</section><p className="data-note">Collected gateway events · Refreshes every 5 seconds · Allowed means accepted for forwarding, not a completed call.</p>
    </>}
    {tab === 'Customers' && <><section>
      <h2>{editId ? 'Edit customer' : 'Add customer'}</h2>
      <div className="customer-setup-note">
        <strong>Connect your customers through SIP Shield</strong>
        <p>Give customers a SIP domain such as <code>sip.example.com</code>. In your DNS provider, create an <strong>A record</strong> for that domain pointing to <strong>SIP Shield's public IP address</strong>. SIP Shield receives the requests and forwards them to your real backend SIP proxy or PBX.</p>
        <p>Saving a customer does not create DNS records. The backend must accept this SIP domain; if it requires its existing domain, keep that domain and configure SIP Shield as the customer's outbound proxy.</p>
      </div>
      <form onSubmit={e => { e.preventDefault(); run(async () => { await api(`/api/customers${editId ? `/${editId}` : ''}`, editId ? 'PUT' : 'POST', form); setForm(emptyCustomer); setEditId(null); }); }}>
        <div className="fields customer-fields">{[
          {key:'name',label:'Name',placeholder:'Example customer',help:'A friendly name to identify this customer.'},
          {key:'domain',label:'Domain',placeholder:'sip.example.com',help:'The SIP domain you give to the customer. Its DNS record should point to SIP Shield.'},
          {key:'backend_host',label:'Backend host',placeholder:'pbx.provider.example',help:'The real SIP proxy or PBX hostname or IP address that receives forwarded requests.'},
          {key:'backend_port',label:'Backend port',help:'The SIP listening port on the backend, usually 5060.'},
        ].map(field => <div key={field.key}>
          <label htmlFor={`customer-${field.key}`}>{field.label}<input id={`customer-${field.key}`} aria-describedby={`customer-help-${field.key}`} required maxLength={255} placeholder={field.placeholder} type={field.key === 'backend_port' ? 'number' : 'text'} min={1} max={field.key === 'backend_port' ? 65535 : undefined} value={form[field.key]} onChange={e => setForm({ ...form, [field.key]: field.key === 'backend_port' ? Number(e.target.value) : e.target.value })} /></label>
          <p className="customer-field-help" id={`customer-help-${field.key}`}>{field.help}</p>
        </div>)}<label className="check"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />Enabled</label></div>
        <button disabled={busy}>Save customer</button>{editId && <button type="button" onClick={() => { setEditId(null); setForm(emptyCustomer); }}>Cancel</button>}
      </form>
    </section><section><Table rows={customers} columns={['name','domain','backend_host','backend_port','enabled']} edit={row => { setForm({ name: row.name, domain: row.domain, backend_host: row.backend_host, backend_port: row.backend_port, enabled: row.enabled }); setEditId(row.id); }} remove={row => remove('/api/customers', row)} /></section></>}
    {tab === 'Rules' && ruleTypes.map(([path, field, title]) => <section key={path}><h2>{title} <small>Apply to validate and activate</small></h2><form onSubmit={e => { e.preventDefault(); const node = e.currentTarget; const data = new FormData(node); run(async () => { await api(`/api/rules/${path}`, 'POST', { [field]: data.get(field), reason: data.get('reason'), customer_id: data.get('customer_id') ? Number(data.get('customer_id')) : null, ...(field === 'ip_cidr' ? { policy: data.get('policy'), expires_at: data.get('expires_at') ? new Date(data.get('expires_at')).toISOString() : null } : {}) }); node.reset(); }); }}><div className="fields"><label>{field}<input name={field} required maxLength={512} placeholder={field === 'ip_cidr' ? '192.0.2.0/24' : field === 'prefix' ? '00900' : 'scanner'} /></label><label>Customer<select name="customer_id"><option value="">Global</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Reason<input name="reason" maxLength={512} /></label>{field === 'ip_cidr' && <><label>Policy<select name="policy"><option value="block">Block</option><option value="allow">Allow (IP exception)</option></select></label><label>Expiry (optional)<input name="expires_at" type="datetime-local" /></label></>}</div><button disabled={busy}>Add rule</button></form><Table rows={rules[path] || []} columns={['customer_id',field,'reason', ...(field === 'ip_cidr' ? ['policy','expires_at'] : [])]} remove={row => remove(`/api/rules/${path}`, row)} /></section>)}
    {tab === 'Auto Defense' && <AutoDefense customers={customers} />}
    {tab === 'SIP Explorer' && <SIPExplorer customers={customers} refreshToken={explorerRefresh} />}
    {tab === 'Events' && <section><div className="section-heading"><div><h2>Gateway sessions</h2><p>One row per Call-ID. Open signaling for all methods and decisions.</p></div><input className="event-search" aria-label="Search latest events" type="search" placeholder="Search IP, caller or Call-ID…" value={eventSearch} onChange={e=>setEventSearch(e.target.value)} /></div>{eventTable}<p className="muted">Latest 100 sessions, ordered by activity. Events without a Call-ID remain separate.</p></section>}
    {tab === 'Settings' && <section><h2>Telegram alerts</h2><p className="muted">Manual test alerts only. Saved bot tokens are not returned by the API. Tokens are stored in the local database.</p><form onSubmit={e => { e.preventDefault(); run(async () => { await api('/api/settings', 'POST', { telegram_chat_id: settings.telegram_chat_id, ...(token ? { telegram_bot_token: token } : {}) }); setToken(''); setNotice('Settings saved.'); }); }}><div className="fields"><label>Bot token<input type="password" autoComplete="new-password" value={token} placeholder={settings.telegram_token_configured ? 'Configured — leave blank to keep' : '123456:token'} onChange={e => setToken(e.target.value)} /></label><label>Chat ID<input value={settings.telegram_chat_id} onChange={e => setSettings({ ...settings, telegram_chat_id: e.target.value })} /></label></div><button disabled={busy}>Save settings</button><button type="button" disabled={busy} onClick={() => run(async () => { await api('/api/alerts/test-telegram', 'POST', {}); setNotice('Test alert sent.'); })}>Send test alert</button></form></section>}
    </main>{eventId && <EventDetails eventId={eventId} onClose={() => setEventId(null)} />}</div>;
}

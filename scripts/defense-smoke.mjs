import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import { once } from 'node:events';
const env=Object.fromEntries((await readFile(new URL('../.env',import.meta.url),'utf8')).split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
let cookie='';
async function api(path,method='GET',body,base='http://localhost:8080') {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(base.includes('3000')?{Origin:base}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=response.status===204?null:await response.json();
  assert.ok(response.ok,JSON.stringify(value));
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return value;
}
for(let attempt=0;;attempt++){try{const ready=await fetch('http://localhost:3000/health');if(ready.ok)break;}catch{}if(attempt>60)throw new Error('API startup timeout');await new Promise(resolve=>setTimeout(resolve,250));}
assert.equal((await fetch('http://localhost:8080/api/customers')).status,401);
await api('/api/auth/login','POST',{username:env.ADMIN_USER||'admin',password:env.ADMIN_PASSWORD},'http://localhost:3000');
await api('/api/customers','GET',undefined,'http://localhost:3000');
async function apply(kind='all') {
  const request=await api(kind==='permissions'?'/api/reload-permissions':'/api/apply-config','POST',{});
  const until=Date.now()+60000;
  while(Date.now()<until){const status=await api(`/api/reload-status?id=${request.id}`);if(['success','failed'].includes(status.status))return status;await new Promise(resolve=>setTimeout(resolve,200));}
  throw new Error('Reload timeout');
}
const client=dgram.createSocket('udp4');client.bind(0,'127.0.0.1');await once(client,'listening');
function sip(domain,user='100',agent='RuntimeSmoke',method='OPTIONS') {
  return new Promise((resolve,reject)=>{const call=crypto.randomUUID();const timer=setTimeout(()=>{client.off('message',receive);reject(new Error('SIP timeout'));},5000);function receive(buffer){const value=buffer.toString();if(!value.includes(call)||value.startsWith('SIP/2.0 100'))return;clearTimeout(timer);client.off('message',receive);resolve(value);}client.on('message',receive);client.send(Buffer.from(`${method} sip:${user}@${domain} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:${client.address().port};branch=z9hG4bK-${call};rport\r\nMax-Forwards: 10\r\nFrom: <sip:100@${domain}>;tag=test\r\nTo: <sip:${user}@${domain}>\r\nCall-ID: ${call}\r\nCSeq: 1 ${method}\r\nUser-Agent: ${agent}\r\nContent-Length: 0\r\n\r\n`),5060,'127.0.0.1');});
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const records=[];
const processes=()=>execFileSync('docker',['compose','exec','-T','kamailio','kamcmd','-s','unix:/rpc/kamailio.sock','core.ps'],{encoding:'utf8'});
const originalProcesses=processes();
async function add(path,body){const row=await api(path,'POST',body);records.push([path,row.id]);return row;}
let responseCode=200;
const backend=dgram.createSocket('udp4');
backend.on('message',(buffer,remote)=>{
  const headers=buffer.toString().split('\r\n').filter(line=>/^(Via|From|To|Call-ID|CSeq):/i.test(line));
  const reply=Buffer.from(`SIP/2.0 ${responseCode} Test\r\n${headers.join('\r\n')}\r\nContent-Length: 0\r\n\r\n`);
  backend.send(reply,remote.port,remote.address);
  if(responseCode>=400) backend.send(reply,remote.port,remote.address);
});
backend.bind(5073,'0.0.0.0');await once(backend,'listening');
try {
  const domain=`defense-${Date.now()}.local`;
  const customer=await add('/api/customers',{name:'Defense smoke',domain,backend_host:'host.docker.internal',backend_port:5073});
  assert.equal((await apply()).status,'success');
  const probe=await sip(domain);const source=probe.match(/received=([^;\r\n ]+)/)[1];
  let rule=await add('/api/behavior-rules',{name:'Defense test',enabled:true,metric:'options',threshold:3,window_seconds:4,block_seconds:3,action:'alert_only',customer_id:customer.id});
  async function edit(change){rule=await api(`/api/behavior-rules/${rule.id}`,'PUT',{...rule,...change});assert.equal((await apply()).status,'success');}
  assert.equal((await apply()).status,'success');
  for(let n=0;n<4;n++)assert.match(await sip(domain),/^SIP\/2.0 200/);
  await wait(1000);
  let logged=(await api('/api/auto-defense/events')).filter(e=>e.behavior_rule_id===rule.id);
  assert.equal(logged.filter(e=>e.action==='would_block').length,1,'One alert per window');
  assert.equal(logged[0].threshold,3);assert.equal(logged[0].window_seconds,4);assert.equal(logged[0].block_seconds,3);
  await edit({action:'block'});
  assert.match(await sip(domain),/^SIP\/2.0 200/);assert.match(await sip(domain),/^SIP\/2.0 200/);
  assert.match(await sip(domain),/^SIP\/2.0 403 Temporarily Blocked/);
  assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),/^SIP\/2.0 403 Temporarily Blocked/);
  assert.match(await sip('defense-unmatched.local'),/^SIP\/2.0 403 Temporarily Blocked/);
  await wait(4200);assert.match(await sip(domain),/^SIP\/2.0 200/);
  await edit({threshold:2});
  assert.match(await sip(domain),/^SIP\/2.0 200/);assert.match(await sip(domain),/^SIP\/2.0 403/);
  const allow=await add('/api/rules/blocked-ips',{customer_id:customer.id,ip_cidr:source.split('.').slice(0,3).join('.')+'.0/24',policy:'allow'});
  assert.equal((await apply('permissions')).status,'success');
  for(let n=0;n<5;n++)assert.match(await sip(domain),/^SIP\/2.0 200/);
  await edit({metric:'response_404',threshold:2});responseCode=404;
  for(let n=0;n<3;n++)assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),/^SIP\/2.0 404 Test/);
  assert.match(await sip(domain),/^SIP\/2.0 200/,'Allowlist also bypasses response detection');
  await api(`/api/rules/blocked-ips/${allow.id}`,'DELETE');
  records.splice(records.findIndex(([path,id])=>path==='/api/rules/blocked-ips'&&id===allow.id),1);
  await wait(4000);assert.equal((await apply('permissions')).status,'success');
  for(const method of ['REGISTER','INVITE']) {
    await edit({metric:method.toLowerCase(),threshold:2});responseCode=200;
    assert.match(await sip(domain,'100','RuntimeSmoke',method),/^SIP\/2.0 200/);
    assert.match(await sip(domain,'100','RuntimeSmoke',method),/^SIP\/2.0 403 Temporarily Blocked/);
    await wait(4200);
  }
  for(const code of [404,403]) {
    await edit({metric:`response_${code}`,threshold:2,window_seconds:4,block_seconds:3});responseCode=code;
    assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),new RegExp(`^SIP/2.0 ${code} Test`));
    assert.match(await sip(domain),/^SIP\/2.0 200/,'Duplicate backend replies count once');
    assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),new RegExp(`^SIP/2.0 ${code} Test`));
    assert.match(await sip(domain),/^SIP\/2.0 403 Temporarily Blocked/);
    await wait(1000);logged=await api('/api/auto-defense/events');
    assert.ok(logged.some(e=>e.behavior_rule_id===rule.id&&e.response_code===code&&e.source_ip===source&&e.method==='REGISTER'&&e.action==='blocked'),`Collected ${code} block uses client IP`);
    await wait(3500);
  }
  await edit({enabled:false});responseCode=200;
  for(let n=0;n<3;n++)assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),/^SIP\/2.0 200/);
  assert.equal(processes(),originalProcesses,'Rule edits preserve Kamailio workers');
  console.log('Auto Defense passed: alert-only, editable thresholds, temporary ban and expiry, CIDR allowlist bypass, disabled rules, and backend 404/403 client attribution.');
} finally {
  for(const [path,id] of records.reverse())await api(`${path}/${id}`,'DELETE');
  assert.equal((await apply()).status,'success');client.close();backend.close();
}

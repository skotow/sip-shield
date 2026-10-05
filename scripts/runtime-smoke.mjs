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
const servers=[];const received=[];
for(const port of [5071,5072]){const socket=dgram.createSocket('udp4');socket.on('message',(buffer,remote)=>{received.push(port);const headers=buffer.toString().split('\r\n').filter(line=>/^(Via|From|To|Call-ID|CSeq):/i.test(line));socket.send(Buffer.from(`SIP/2.0 200 OK\r\n${headers.join('\r\n')}\r\nContent-Length: 0\r\n\r\n`),remote.port,remote.address);});socket.bind(port,'0.0.0.0');await once(socket,'listening');servers.push(socket);}
const docker=(...args)=>execFileSync('docker',['compose',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const processes=()=>docker('exec','-T','kamailio','kamcmd','-s','unix:/rpc/kamailio.sock','core.ps');
const before=processes();const records=[];let outage=false;
async function add(path,body){const value=await api(path,'POST',body);records.push([path,value.id]);return value;}
try {
  const domain=`runtime-${Date.now()}.local`;
  const customer=await add('/api/customers',{name:'Runtime smoke',domain,backend_host:'host.docker.internal',backend_port:5071});
  assert.equal((await apply()).status,'success');
  assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),/^SIP\/2.0 200/);assert.equal(received.at(-1),5071);
  await api(`/api/customers/${customer.id}`,'PUT',{...customer,backend_port:5072});
  assert.equal((await apply()).status,'success');
  assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),/^SIP\/2.0 200/);assert.equal(received.at(-1),5072);
  const probe=await sip(domain);const source=probe.match(/received=([^;\r\n ]+)/)[1];
  const network=source.split('.').slice(0,3).join('.')+'.0/24';
  const block=await add('/api/rules/blocked-ips',{customer_id:customer.id,ip_cidr:network});
  assert.equal((await apply('permissions')).status,'success');
  assert.match(await sip(domain),/^SIP\/2.0 403/);
  const allow=await add('/api/rules/blocked-ips',{customer_id:customer.id,ip_cidr:source,policy:'allow'});
  assert.equal((await apply('permissions')).status,'success');
  assert.match(await sip(domain),/^SIP\/2.0 200/);
  const agent=await add('/api/rules/user-agents',{customer_id:customer.id,pattern:'Literal/1.0 (+test)'});
  const prefix=await add('/api/rules/prefixes',{customer_id:customer.id,prefix:'+900'});
  assert.equal((await apply()).status,'success');
  assert.match(await sip(domain,'100','LITERAL/1.0 (+TEST)'),/^SIP\/2.0 403/);
  assert.match(await sip(domain,'+900123'),/^SIP\/2.0 403/);
  await new Promise(resolve=>setTimeout(resolve,1500));
  assert.ok((await api('/api/events?limit=1000')).some(event=>event.customer_id===customer.id&&event.reason==='blocked_ip'));
  docker('exec','-T','postgres','psql','-U','sipshield','-d','sipshield','-c',"INSERT INTO address(grp,ip_addr,mask,tag,bank) VALUES(777,'192.0.2.255',999,'smoke-invalid-runtime',(SELECT ip_bank FROM runtime_state WHERE id=1))");
  try {
    const rejected=await apply('permissions');assert.equal(rejected.status,'failed');assert.ok(rejected.error.includes('permissions.addressReload'));
    assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),/^SIP\/2.0 200/);
    assert.match(await sip(domain,'100','Literal/1.0 (+test)'),/^SIP\/2.0 403/);
  } finally { docker('exec','-T','postgres','psql','-U','sipshield','-d','sipshield','-c',"DELETE FROM address WHERE tag='smoke-invalid-runtime'"); }
  assert.equal((await apply('permissions')).status,'success');
  // Invalid backend resolution must not switch selectors or stop SIP workers.
  await api(`/api/customers/${customer.id}`,'PUT',{...customer,backend_host:'no-such-backend.invalid',backend_port:5072});
  const failed=await apply();assert.equal(failed.status,'failed',JSON.stringify(failed));
  assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),/^SIP\/2.0 200/);assert.equal(received.at(-1),5072);
  await api(`/api/customers/${customer.id}`,'PUT',{...customer,backend_port:5072});assert.equal((await apply()).status,'success');
  assert.equal(processes(),before,'Runtime updates never replace SIP processes');
  outage=true;docker('stop','api','redis','postgres');
  assert.match(await sip(domain,'100','RuntimeSmoke','REGISTER'),/^SIP\/2.0 200/);
  assert.match(await sip(domain,'100','Literal/1.0 (+test)'),/^SIP\/2.0 403/);
  docker('start','postgres','redis','api');outage=false;
  console.log('Authentication, CIDR block/allow, route changes, literal filters, JSON event ingestion, failed-reload preservation, stable SIP PIDs and management-outage forwarding passed.');
} finally {
  if(outage)docker('start','postgres','redis','api');
  for(let attempt=0;attempt<60;attempt++){try{await api('/api/auth/session');break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
  for(const [path,id] of records.reverse())await api(`${path}/${id}`,'DELETE');
  assert.equal((await apply()).status,'success');client.close();servers.forEach(socket=>socket.close());
}

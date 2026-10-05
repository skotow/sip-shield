import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
let backendCode=401;
const backend=dgram.createSocket('udp4');
backend.on('message',(buffer,remote)=>{
  const headers=buffer.toString().split('\r\n').filter(line=>/^(Via|From|To|Call-ID|CSeq):/i.test(line));
  backend.send(Buffer.from(`SIP/2.0 ${backendCode} ${backendCode===401?'Unauthorized':'OK'}\r\n${headers.join('\r\n')}\r\nWWW-Authenticate: Digest nonce="challenge-secret"\r\nContent-Length: 0\r\n\r\n`),remote.port,remote.address);
});
backend.bind(5075,'0.0.0.0');await once(backend,'listening');
const call=crypto.randomUUID();
function sip(domain,seq=1,agent='CaptureSmoke'){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{client.off('message',receive);reject(new Error('SIP timeout'));},5000);
    function receive(buffer){const text=buffer.toString();if(!text.includes(`CSeq: ${seq} REGISTER`)||!text.includes(call)||text.startsWith('SIP/2.0 100'))return;clearTimeout(timer);client.off('message',receive);resolve(text);}
    client.on('message',receive);
    const body='body-secret';
    client.send(Buffer.from(`REGISTER sip:${domain} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:${client.address().port};branch=z9hG4bK-${crypto.randomUUID()};rport\r\nMax-Forwards: 10\r\nFrom: <sip:100@${domain}>;tag=test\r\nTo: <sip:100@${domain}>\r\nCall-ID: ${call}\r\nCSeq: ${seq} REGISTER\r\nUser-Agent: ${agent}\r\nAuthorization: Digest username="100", response="credential-secret"\r\n continuation-secret\r\nX-Secret-Token: custom-secret\r\nContent-Type: application/sdp\r\nContent-Length: ${body.length}\r\n\r\n${body}`),5060,'127.0.0.1');
  });
}
let customer;
try {
  const domain=`capture-${Date.now()}.local`;
  customer=await api('/api/customers','POST',{name:'Capture smoke',domain,backend_host:'host.docker.internal',backend_port:5075});
  assert.equal((await apply()).status,'success');
  assert.match(await sip(domain),/^SIP\/2.0 401/);
  backendCode=200;assert.match(await sip(domain,2),/^SIP\/2.0 200/);
  assert.match(await sip(domain,3,'friendly-scanner'),/^SIP\/2.0 403/);
  let details;
  for(let attempt=0;attempt<60;attempt++){
    const events=await api('/api/events?limit=1000');
    const event=events.find(e=>e.call_id===call);
    if(event){details=await api(`/api/events/${event.id}`);if(details.messages.length>=10)break;}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(details&&details.messages.length>=10,'Both hops of requests/replies and local denial captured');
  for(const code of [401,200,403])assert.ok(details.messages.some(m=>m.response_code===code),`Captured ${code}`);
  assert.ok(details.messages.some(m=>m.source_role==='gateway'&&m.destination_port===5075&&m.message.includes('X-SIPShield-Source-IP:')),'Forwarded payload includes trusted headers');
  assert.ok(details.messages.some(m=>m.destination_role==='gateway'&&m.method==='REGISTER'&&!m.response_code),'Incoming client request captured');
  assert.ok(details.messages.every(m=>!m.message.includes('secret')),'Authentication, custom secrets, folded values and bodies redacted');
  assert.ok(details.messages.some(m=>m.message.includes('Authorization: [redacted]')));
  assert.ok(details.decisions.some(e=>e.action==='blocked'&&e.reason==='scanner'));
  assert.equal((await fetch(`http://localhost:8080/api/events/${details.event.id}`)).status,401);
  console.log(`Call-flow capture passed: ${details.messages.length} real hops, 401/200/403 replies, Call-ID grouping, redaction, and authenticated detail access.`);
} finally {
  if(customer){await api(`/api/customers/${customer.id}`,'DELETE');assert.equal((await apply()).status,'success');}
  client.close();backend.close();
}

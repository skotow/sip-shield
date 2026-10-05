import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import dgram from 'node:dgram';
import {once} from 'node:events';
const env=Object.fromEntries((await readFile(new URL('../.env',import.meta.url),'utf8')).split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
let cookie='';
async function request(path,method='GET',body){return fetch('http://localhost:8080'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});}
async function api(path,method='GET',body){const response=await request(path,method,body);const data=response.status===204?null:await response.json();assert.ok(response.ok,JSON.stringify(data));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return data;}
async function apply(){const job=await api('/api/apply-config','POST',{});for(let i=0;i<150;i++){const status=await api('/api/reload-status?id='+job.id);if(status.status==='failed')throw new Error(status.message);if(status.status==='success')return;await new Promise(r=>setTimeout(r,200));}throw new Error('Runtime reload timeout');}
assert.equal((await fetch('http://localhost:8080/api/sip-events/search')).status,401);
await api('/api/auth/login','POST',{username:env.ADMIN_USER||'admin',password:env.ADMIN_PASSWORD});
const client=dgram.createSocket('udp4');client.bind(0,'127.0.0.1');await once(client,'listening');
const backend=dgram.createSocket('udp4');backend.on('message',(buffer,remote)=>{const headers=buffer.toString().split('\r\n').filter(line=>/^(Via|From|To|Call-ID|CSeq):/i.test(line));backend.send(Buffer.from(`SIP/2.0 404 Not Found\r\n${headers.join('\r\n')}\r\nContent-Length: 0\r\n\r\n`),remote.port,remote.address);});backend.bind(5076,'0.0.0.0');await once(backend,'listening');
const call=crypto.randomUUID();let customer;
async function send(domain,seq,agent){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{client.off('message',receive);reject(new Error('SIP response timeout'));},5000);function receive(buffer){const text=buffer.toString();if(!text.includes(call)||!text.includes(`CSeq: ${seq} REGISTER`)||text.startsWith('SIP/2.0 100'))return;clearTimeout(timer);client.off('message',receive);resolve(text);}client.on('message',receive);client.send(Buffer.from(`REGISTER sip:+12025550100${seq===1?':explorer-uri-secret':''}@${domain} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:${client.address().port};branch=z9hG4bK-${crypto.randomUUID()};rport\r\nMax-Forwards: 10\r\nFrom: <sip:100@caller.example>;tag=test\r\nTo: <sip:+12025550100@${domain}>\r\nCall-ID: ${call}\r\nCSeq: ${seq} REGISTER\r\nUser-Agent: ${agent}\r\nAuthorization: Digest response="explorer-secret"\r\nContent-Length: 0\r\n\r\n`),5060,'127.0.0.1');});}
try{
  const domain=`explorer-${Date.now()}.local`;
  customer=await api('/api/customers','POST',{name:'Explorer smoke',domain,backend_host:'host.docker.internal',backend_port:5076});await apply();
  assert.match(await send(domain,1,'ExplorerSmoke%_'),/^SIP\/2.0 404/);
  assert.match(await send(domain,2,'friendly-scanner'),/^SIP\/2.0 403/);
  const query=new URLSearchParams({call_id:call});
  let result;
  for(let i=0;i<80;i++){result=await api('/api/sip-events/search?'+query);if(result.events.length>=3)break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(result.events.length,3);assert.equal(result.summary.total_events,3);assert.equal(result.summary.allowed,2);assert.equal(result.summary.blocked,1);
  const forwarded=result.events.find(e=>e.reason==='forwarded');const reply=result.events.find(e=>e.reason==='backend_response');const blocked=result.events.find(e=>e.action==='blocked');
  // Docker Desktop can translate the client port; assert the gateway-observed
  // socket identity remains unchanged across request and backend reply events.
  for(const event of result.events){assert.equal(event.customer_id,customer.id);assert.ok(event.source_port>0&&event.source_port<=65535);assert.equal(event.source_port,forwarded.source_port);assert.equal(event.transport,'udp');assert.equal(event.from_domain,'caller.example');assert.equal(event.to_domain,domain);assert.equal(event.called_number,'+12025550100');assert.equal(event.caller_id,'100');assert.equal(event.request_uri,`sip:+12025550100@${domain}`);assert.equal(event.asn,null);assert.equal(event.country,null);assert.ok(!JSON.stringify(event).includes('explorer-secret'));}
  assert.equal(forwarded.backend_host,'host.docker.internal');assert.equal(forwarded.backend_port,5076);assert.equal(reply.source_ip,forwarded.source_ip);assert.equal(reply.backend_host,forwarded.backend_host);assert.equal(reply.response_code,404);assert.equal(reply.response_reason,'Not Found');assert.equal(blocked.response_code,403);assert.equal(blocked.response_reason,'Forbidden');assert.equal(blocked.backend_host,null);assert.ok(!JSON.stringify(result).includes('uri-secret'));
  for(const [key,value] of Object.entries({customer_id:customer.id,source_ip:forwarded.source_ip,called_number:'+12025550100',caller_id:'100',backend_host:'host.docker.internal',method:'register',response_code:'404',action:'allowed',user_agent:'Smoke%_'})){
    const filtered=await api('/api/sip-events/search?'+new URLSearchParams({call_id:call,[key]:String(value)}));assert.ok(filtered.events.length>0,key);if(key==='response_code')assert.equal(filtered.events.length,1);if(key==='user_agent')assert.equal(filtered.events.length,2);
  }
  for(const filter of ['asn=64500','country=US',"caller_id=100%27%20OR%20true--"]){assert.equal((await api(`/api/sip-events/search?call_id=${call}&${filter}`)).summary.total_events,0);}
  const page=await api('/api/sip-events/search?'+new URLSearchParams({call_id:call,limit:'1',offset:'1'}));assert.equal(page.events.length,1);assert.equal(page.summary.total_events,3);
  const csv=await request('/api/sip-events/search?'+new URLSearchParams({call_id:call,format:'csv',limit:'1'}));assert.match(csv.headers.get('content-type'),/text\/csv/);const content=await csv.text();assert.equal(content.split('\r\n').length,3);assert.ok(content.includes('"\'+12025550100"'));
  for(const query of ['limit=1001','offset=-1','source_ip=oops','date_from=2020-01-01T00:00:00Z&date_to=2026-01-01T00:00:00Z'])assert.equal((await request('/api/sip-events/search?'+query)).status,400);
  console.log('SIP Explorer passed: real request/404/403 metadata, original source attribution, filters, summaries, pagination, safe CSV, authentication and input bounds.');
}finally{if(customer){await api('/api/customers/'+customer.id,'DELETE');await apply();}client.close();backend.close();}

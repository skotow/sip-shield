import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import dgram from 'node:dgram';
import {once} from 'node:events';
const env=Object.fromEntries((await readFile(new URL('../.env',import.meta.url),'utf8')).split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
let cookie='';
async function api(path,method='GET',body){const response=await fetch('http://localhost:8080'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});const data=response.status===204?null:await response.json();assert.ok(response.ok,JSON.stringify(data));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return data;}
async function importCsv(csv,customerId){return fetch('http://localhost:8080/api/rules/prefixes/import'+(customerId?'?customer_id='+customerId:''),{method:'POST',headers:{'Content-Type':'text/csv',Cookie:cookie},body:csv});}
async function wait(id){for(let i=0;i<150;i++){const status=await api('/api/reload-status?id='+id);if(status.status==='failed')throw new Error(status.message);if(status.status==='success')return;await new Promise(r=>setTimeout(r,200));}throw new Error('Runtime update timeout');}
assert.equal((await importCsv('prefix\n00900\n')).status,401);
await api('/api/auth/login','POST',{username:env.ADMIN_USER||'admin',password:env.ADMIN_PASSWORD});
const client=dgram.createSocket('udp4');client.bind(0,'127.0.0.1');await once(client,'listening');
const backend=dgram.createSocket('udp4');backend.on('message',(buffer,remote)=>{const headers=buffer.toString().split('\r\n').filter(line=>/^(Via|From|To|Call-ID|CSeq):/i.test(line));backend.send(Buffer.from(`SIP/2.0 404 Not Found\r\n${headers.join('\r\n')}\r\nContent-Length: 0\r\n\r\n`),remote.port,remote.address);});backend.bind(5078,'0.0.0.0');await once(backend,'listening');
async function sip(domain,number){const call=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{client.off('message',receive);reject(new Error('SIP timeout'));},5000);function receive(buffer){const text=buffer.toString();if(!text.includes(call)||text.startsWith('SIP/2.0 100'))return;clearTimeout(timer);client.off('message',receive);resolve(text);}client.on('message',receive);client.send(Buffer.from(`REGISTER sip:${number}@${domain} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:${client.address().port};branch=z9hG4bK-${call};rport\r\nMax-Forwards: 10\r\nFrom: <sip:100@${domain}>;tag=test\r\nTo: <sip:${number}@${domain}>\r\nCall-ID: ${call}\r\nCSeq: 1 REGISTER\r\nUser-Agent: PrefixCSVSmoke\r\nContent-Length: 0\r\n\r\n`),5060,'127.0.0.1');});}
let customer;
try{
  const domain=`csv-${Date.now()}.local`;customer=await api('/api/customers','POST',{name:'CSV smoke',domain,backend_host:'host.docker.internal',backend_port:5078});
  assert.equal((await importCsv('prefix,reason\n00900,valid\nBAD,invalid',customer.id)).status,400);
  assert.equal((await api('/api/rules/prefixes')).filter(r=>r.customer_id===customer.id).length,0);
  assert.equal((await importCsv('prefix\n00900',2147483647)).status,400);
  const csv='prefix,reason\r\n00900,"Premium, rate"\r\n+1900,Premium\r\n00900,duplicate\r\n*887,Test\r\n';
  const first=await importCsv(csv,customer.id);assert.equal(first.status,201);const result=await first.json();assert.equal(result.imported,3);assert.equal(result.skipped,1);await wait(result.reload_id);
  const repeated=await (await importCsv(csv,customer.id)).json();assert.equal(repeated.imported,0);assert.equal(repeated.skipped,4);assert.equal(repeated.reload_id,null);
  const rules=(await api('/api/rules/prefixes')).filter(r=>r.customer_id===customer.id);assert.equal(rules.length,3);assert.equal(rules.find(r=>r.prefix==='00900').reason,'Premium, rate');
  assert.match(await sip(domain,'00900123'),/^SIP\/2.0 403/);assert.match(await sip(domain,'+1900123'),/^SIP\/2.0 403/);assert.match(await sip(domain,'100'),/^SIP\/2.0 404/);
  assert.equal((await importCsv('prefix\n'+'1\n'.repeat(1001),customer.id)).status,400);
  assert.equal((await importCsv('x'.repeat(1048577),customer.id)).status,413);
  assert.equal((await api('/api/rules/prefixes')).filter(r=>r.customer_id===customer.id).length,3);
  console.log('Prefix CSV passed: authentication, atomic validation, duplicate skipping, leading zeros, quoted reasons, bounded uploads and real SIP blocking after runtime activation.');
}finally{if(customer){await api('/api/customers/'+customer.id,'DELETE');await wait((await api('/api/apply-config','POST',{})).id);}client.close();backend.close();}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
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
const captured=[];
const backend=dgram.createSocket('udp4');
backend.on('message',(buffer,remote)=>{
  const message=buffer.toString();captured.push(message);
  const headers=message.split('\r\n').filter(line=>/^(Via|From|To|Call-ID|CSeq):/i.test(line));
  backend.send(Buffer.from(`SIP/2.0 200 OK\r\n${headers.join('\r\n')}\r\nContent-Length: 0\r\n\r\n`),remote.port,remote.address);
});
backend.bind(5074,'0.0.0.0');await once(backend,'listening');
const forged=['X-SIPShield-Source-IP: 203.0.113.99','x-sipshield-source-ip: 203.0.113.98','X-SIPShield-Source-Port: 1','X-SIPShield-Transport: fake','X-SIPShield-Decision: bypass','X-SIPShield-Customer: spoofed','X-Original-Source-IP: 203.0.113.97','x-original-source-ip: 203.0.113.96','X-SIPShield-Untrusted: spoofed'];
function request(domain,method,agent,protocol,port,call) {
  return `${method} sip:100@${domain} SIP/2.0\r\nVia: SIP/2.0/${protocol.toUpperCase()} 127.0.0.1:${port};branch=z9hG4bK-${call};rport\r\nMax-Forwards: 10\r\nFrom: <sip:100@${domain}>;tag=test\r\nTo: <sip:100@${domain}>\r\nCall-ID: ${call}\r\nCSeq: 1 ${method}\r\nUser-Agent: ${agent}\r\n${forged.join('\r\n')}\r\nContent-Length: 0\r\n\r\n`;
}
async function sip(domain,method='INVITE',agent='SourceSmoke',protocol='udp') {
  const call=crypto.randomUUID();
  if(protocol==='tcp') {
    const socket=net.createConnection({host:'127.0.0.1',port:5060});await once(socket,'connect');
    try {
      return await new Promise((resolve,reject)=>{
        let data='';const timer=setTimeout(()=>reject(new Error('TCP SIP timeout')),5000);
        socket.on('error',error=>{clearTimeout(timer);reject(error);});
        socket.on('data',buffer=>{data+=buffer.toString();for(const reply of data.split('\r\n\r\n'))if(reply.includes(call)&&/^SIP\/2.0 [2-6]/.test(reply)){clearTimeout(timer);resolve(reply);return;}});
        socket.write(request(domain,method,agent,protocol,socket.localPort,call));
      });
    } finally {socket.destroy();}
  }
  return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{client.off('message',receive);reject(new Error('UDP SIP timeout'));},5000);
    function receive(buffer){const value=buffer.toString();if(!value.includes(call)||value.startsWith('SIP/2.0 100'))return;clearTimeout(timer);client.off('message',receive);resolve(value);}
    client.on('message',receive);client.send(Buffer.from(request(domain,method,agent,protocol,client.address().port,call)),5060,'127.0.0.1');
  });
}
function values(message,name){return message.split('\r\n').filter(line=>line.toLowerCase().startsWith(name.toLowerCase()+':')).map(line=>line.slice(line.indexOf(':')+1).trim());}
function check(message,reply,domain,protocol){
  const source=reply.match(/received=([^;\r\n ]+)/)?.[1];
  const port=reply.match(/rport=(\d+)/)?.[1];
  assert.ok(source&&port,'Socket source reported in Via response');
  for(const [name,value] of Object.entries({'X-SIPShield-Source-IP':source,'X-SIPShield-Source-Port':port,'X-SIPShield-Transport':protocol,'X-SIPShield-Decision':'allowed','X-SIPShield-Customer':domain,'X-Original-Source-IP':source}))assert.deepEqual(values(message,name),[value],name);
  assert.equal(values(message,'X-SIPShield-Untrusted').length,0,'Entire reserved namespace stripped');
  assert.ok(!message.includes('203.0.113.'),'Forged source values removed');
}
let customer;
try {
  const domain=`source-${Date.now()}.local`;
  customer=await api('/api/customers','POST',{name:'Source headers smoke',domain,backend_host:'host.docker.internal',backend_port:5074});
  assert.equal((await apply()).status,'success');
  for(const protocol of ['udp','tcp'])for(const method of ['INVITE','REGISTER']){
    const reply=await sip(domain,method,'SourceSmoke',protocol);assert.match(reply,/^SIP\/2.0 200/);
    const message=captured.at(-1);assert.ok(message.startsWith(method+' '));check(message,reply,domain,protocol);
  }
  const before=captured.length;
  for(const [method,agent,status] of [['INVITE','friendly-scanner',403],['OPTIONS','SourceSmoke',200]]){
    const reply=await sip(domain,method,agent);assert.match(reply,new RegExp(`^SIP/2.0 ${status}`));
    assert.ok(!/^X-(SIPShield-|Original-Source-IP:)/im.test(reply),'Local replies are not enriched');
  }
  assert.equal(captured.length,before,'Blocked and local OPTIONS requests never reach backend');
  console.log('Source headers passed: UDP/TCP INVITE and REGISTER, duplicate/case-varied spoof removal, socket IP/port, matched domain, and no enrichment of blocked/local replies.');
} finally {
  if(customer){await api(`/api/customers/${customer.id}`,'DELETE');assert.equal((await apply()).status,'success');}
  client.close();backend.close();
}

"""Private HEP3 receiver. Redact before durable journaling, never touch SQL."""
import datetime
import json
import re
import socket
import struct
import threading
import time

MAX_MESSAGE = 16384
SAFE_HEADERS = {
    'via','v','from','f','to','t','call-id','i','cseq','contact','m','route',
    'record-route','max-forwards','allow','supported','k','require','expires',
    'min-expires','user-agent','server','content-type','c','content-length','l',
    'date','warning','reason','retry-after','session-expires','min-se',
    'p-asserted-identity','p-preferred-identity','remote-party-id','diversion',
    'x-sipshield-source-ip','x-sipshield-source-port','x-sipshield-transport',
    'x-sipshield-decision','x-sipshield-customer','x-original-source-ip',
}

def hide_uri_passwords(value):
    return re.sub(r'(sips?:)([^@\s<>]+)@',
                  lambda m:m[1]+(m[2].split(':',1)[0]+':[redacted]' if ':' in m[2] else m[2])+'@',value,flags=re.I)

def sanitize(payload):
    text = payload.decode('utf8',errors='replace').replace('\r\n','\n')
    # PostgreSQL rejects NUL in text. Untrusted malformed packets must not
    # poison a journal record and stall the asynchronous collector.
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]','\ufffd',text)
    head,_,body = text.partition('\n\n')
    # Unfold continuation lines before filtering so credentials cannot escape.
    lines = re.sub(r'\n[ \t]+',' ',head).split('\n')
    first = hide_uri_passwords(lines[0])
    headers = {}
    output = [first]
    for line in lines[1:]:
        name,sep,value = line.partition(':')
        if not sep: continue
        key = name.strip().lower()
        value = value.strip()
        headers.setdefault(key,value)
        output.append(name.strip()+': '+(hide_uri_passwords(value) if key in SAFE_HEADERS else '[redacted]'))
    if body: output.extend(['',f'[Body omitted: {len(body.encode("utf8"))} bytes]'])
    message = '\r\n'.join(output)
    # Metadata is bounded too; untrusted Call-IDs never become filesystem paths.
    call_id = headers.get('call-id',headers.get('i',''))[:512]
    cseq = headers.get('cseq','')[:128]
    match = re.match(r'^SIP/2\.0 (\d{3})\b',first)
    method = cseq.split()[-1] if match and cseq else first.split(' ',1)[0]
    return dict(call_id=call_id,first_line=first[:1024],cseq=cseq,
                method=method[:32],response_code=int(match[1]) if match else None,
                message=message[:MAX_MESSAGE],truncated=len(message)>MAX_MESSAGE)

def decode(packet, local_ips):
    if len(packet)<6 or packet[:4]!=b'HEP3': raise ValueError('Not HEP3')
    total = struct.unpack_from('!H',packet,4)[0]
    if total!=len(packet): raise ValueError('Invalid HEP length')
    chunks={};offset=6
    while offset<total:
        if offset+6>total: raise ValueError('Short HEP chunk')
        vendor,kind,size=struct.unpack_from('!HHH',packet,offset)
        if size<6 or offset+size>total: raise ValueError('Invalid HEP chunk')
        if vendor==0: chunks[kind]=packet[offset+6:offset+size]
        offset+=size
    def number(kind): return int.from_bytes(chunks[kind],'big')
    def address(v4,v6):
        return socket.inet_ntop(socket.AF_INET,chunks[v4]) if v4 in chunks else socket.inet_ntop(socket.AF_INET6,chunks[v6])
    payload=chunks[15]
    record=sanitize(payload)
    if not record['call_id']: return None
    source=address(3,5);destination=address(4,6)
    sp=number(7);dp=number(8)
    record.update(kind='sip_message',timestamp=number(9)+number(10)/1000000,
                  source_ip=source,source_port=sp,destination_ip=destination,destination_port=dp,
                  transport={6:'tcp',17:'udp',132:'sctp'}.get(number(2),'unknown'),
                  source_role='gateway' if source in local_ips and sp==5060 else 'peer',
                  destination_role='gateway' if destination in local_ips and dp==5060 else 'peer',
                  size_bytes=len(payload))
    return record

def start():
    def receive():
        local_ips={'0.0.0.0','127.0.0.1','::','::1'}
        local_ips.update(item[4][0] for item in socket.getaddrinfo(socket.gethostname(),None))
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as receiver:
            receiver.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1048576)
            receiver.bind(('127.0.0.1',9060))
            last_warning=0
            while True:
                packet,_=receiver.recvfrom(65535)
                try:
                    record=decode(packet,local_ips)
                    if record:
                        name=datetime.datetime.now(datetime.timezone.utc).strftime('traces-%Y%m%d%H.jsonl')
                        with open('/logs/'+name,'a') as journal:
                            journal.write(json.dumps(record)+'\n')
                except Exception as error:
                    if time.time()-last_warning>10:
                        print(f'Trace capture dropped message: {type(error).__name__}',flush=True)
                        last_warning=time.time()
    threading.Thread(target=receive,daemon=True).start()

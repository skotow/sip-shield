"""Persistent file journal consumer; PostgreSQL outages do not affect SIP."""
import hashlib, json, pathlib, time
from table_worker_connection import connect
root=pathlib.Path('/logs')
state_file=root/'collector-offsets.json'
offsets=json.loads(state_file.read_text()) if state_file.exists() else {}
while True:
    connection=None
    try:
        connection=connect()
        for path in sorted([*root.glob('events-*.jsonl'),*root.glob('traces-*.jsonl')]):
            with path.open() as stream:
                stream.seek(offsets.get(path.name,0))
                while True:
                    line=stream.readline()
                    if not line: break
                    if not line.endswith('\n'): break
                    record=json.loads(line)
                    key=hashlib.sha256((path.name+str(offsets.get(path.name,0))+line).encode()).hexdigest()
                    with connection.cursor() as cur:
                        if record.get('kind')=='sip_message':
                            fields=['call_id','timestamp','source_ip','source_port','destination_ip','destination_port','transport','source_role','destination_role','first_line','method','response_code','cseq','message','size_bytes','truncated']
                            cur.execute('INSERT INTO sip_messages(event_key,call_id,captured_at,source_ip,source_port,destination_ip,destination_port,transport,source_role,destination_role,first_line,method,response_code,cseq,message,size_bytes,truncated) VALUES(%s,%s,to_timestamp(%s),%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(event_key) DO NOTHING',(key,*[record.get(field) for field in fields]))
                        else:
                            fields=['source_ip','source_port','transport','method','from_user','from_domain','to_user','to_domain','request_uri','called_number','caller_id','user_agent','destination','backend_host','backend_port','action','reason','call_id','response_code','response_reason','threshold','window_seconds','block_seconds','behavior_rule_id','asn','asn_name','country']
                            values=[None if record.get(field) in (None,'','<null>') else record[field] for field in fields]
                            cur.execute('INSERT INTO sip_events(event_key,customer_id,created_at,'+','.join(fields)+') VALUES(%s,(SELECT id FROM customers WHERE id=%s),to_timestamp(%s),'+','.join(['%s']*len(fields))+') ON CONFLICT(event_key) DO NOTHING',(key,record.get('customer_id') or None,record.get('timestamp',time.time()),*values))
                    connection.commit()
                    offsets[path.name]=stream.tell()
                    temp=root/'.offsets.tmp';temp.write_text(json.dumps(offsets));temp.replace(state_file)
        time.sleep(0.5)
    except Exception as error:
        print(f'Collector retry: {error}',flush=True);time.sleep(2)
    finally:
        if connection: connection.close()

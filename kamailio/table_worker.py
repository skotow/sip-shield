"""Load inactive DB generations and flip selectors only after successful RPCs."""
import datetime, ipaddress, json, os, pathlib, re, socket, subprocess, time, uuid
from table_worker_connection import connect
from psycopg2.extras import RealDictCursor

def rpc(method, *args):
    result = subprocess.run(['kamcmd','-s','unix:/rpc/kamailio.sock',method,*map(str,args)],capture_output=True,text=True,timeout=15)
    # kamcmd can exit zero even when the RPC reply is a fault.
    if result.returncode or re.search(r'^error:',result.stdout,re.MULTILINE|re.IGNORECASE):
        raise RuntimeError(f'{method}: {result.stderr or result.stdout}')
    return result.stdout

def sync(connection, kind):
    with connection.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT * FROM runtime_state WHERE id=1 FOR UPDATE')
        state = cur.fetchone()
        cur.execute('SELECT * FROM customers WHERE enabled ORDER BY id')
        customers = cur.fetchall()
        domains = {}
        for customer in customers:
            domain = customer['domain'].lower()
            host = customer['backend_host']
            if not re.fullmatch(r'[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*',domain) or domain in domains:
                raise ValueError('Invalid or duplicate customer domain')
            if kind!='permissions' and (not re.fullmatch(r'[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*',host) or customer['id'] >= 400000):
                raise ValueError('Invalid backend hostname or customer ID')
            domains[domain] = customer['id']
            if kind!='permissions': socket.getaddrinfo(host,customer['backend_port'],type=socket.SOCK_DGRAM)
        if kind=='permissions':
            cur.execute('SELECT key_name,key_value FROM runtime_kv WHERE bank=%s AND value_type=1',(state['bank'],))
            domains={row['key_name'].split(':',1)[1]:int(row['key_value']) for row in cur.fetchall()}
        ipbank = 1 - state['ip_bank']
        bank = 1 - state['bank']
        cur.execute('DELETE FROM address WHERE bank=%s',(ipbank,))
        cur.execute('SELECT * FROM blocked_ips WHERE expires_at IS NULL OR expires_at>now()')
        for rule in cur.fetchall():
            if rule['customer_id'] and rule['customer_id'] not in domains.values(): continue
            network = ipaddress.ip_network(rule['ip_cidr'],strict=False)
            networks = list(network.subnets(prefixlen_diff=1)) if network.prefixlen == 0 else [network]
            group = ipbank*1000000 + ((rule['customer_id']*2+10) if rule['customer_id'] else 1) + (1 if rule['policy']=='allow' else 0)
            for net in networks:
                cur.execute('INSERT INTO address(grp,ip_addr,mask,port,tag,bank) VALUES(%s,%s,%s,0,%s,%s)',(group,str(net.network_address),net.prefixlen,rule['policy'],ipbank))
        if kind != 'permissions':
            cur.execute('DELETE FROM dispatcher WHERE bank=%s',(bank,))
            cur.execute('DELETE FROM runtime_kv WHERE bank=%s',(bank,))
            def kv(key,value,integer=False):
                cur.execute('INSERT INTO runtime_kv(key_name,value_type,key_value,bank) VALUES(%s,%s,%s,%s)',(f'{bank}:{key}',int(integer),str(value),bank))
            for customer in customers:
                kv(customer['domain'].lower(),customer['id'],True)
                cur.execute('INSERT INTO dispatcher(setid,destination,description,bank) VALUES(%s,%s,%s,%s)',(bank*1000000+customer['id']+10,f"sip:{customer['backend_host']}:{customer['backend_port']}",'SIP Shield',bank))
            cur.execute('SELECT * FROM behavior_rules WHERE enabled ORDER BY id')
            behavior = {}
            for rule in cur.fetchall():
                if rule['customer_id'] and rule['customer_id'] not in domains.values(): continue
                # Names stay in PostgreSQL; numeric fields and enum strings are safe
                # across htable's DB string decoding. Revision resets edited counters.
                item = {key:rule[key] for key in ['id','revision','threshold','window_seconds','block_seconds','action']}
                behavior.setdefault((rule['customer_id'] or 0,rule['metric']),[]).append(item)
            for (scope,metric),items in behavior.items():
                if len(items)>32: raise ValueError('Maximum 32 enabled behavior rules per scope and metric')
                kv(f'defense:{scope}:{metric}',json.dumps(items))
            for table,field,label in [('blocked_user_agents','pattern','ua'),('blocked_prefixes','prefix','prefix')]:
                cur.execute(f'SELECT * FROM {table}')
                patterns = {}
                for rule in cur.fetchall():
                    if rule['customer_id'] and rule['customer_id'] not in domains.values(): continue
                    value = rule[field]
                    if not value or len(value)>512 or any(ord(c)<32 or ord(c)>126 for c in value) or any(c in value for c in '\\^'): raise ValueError('Use printable literal filters without backslash or caret')
                    if label=='prefix' and not re.fullmatch(r'[+0-9*#]{1,64}',value): raise ValueError('Invalid dial prefix')
                    # Character classes survive htable DB string unescaping.
                    escaped = ''.join('[[]' if c=='[' else '[]]' if c==']' else '['+c+']' if c in '.+?*(){}|$' else c for c in value.lower())
                    patterns.setdefault(rule['customer_id'] or 0,[]).append(('^' if label=='prefix' else '')+escaped)
                for customer_id,values in patterns.items(): kv(f'{label}:{customer_id}','('+'|'.join(values)+')')
        connection.commit()
    # DB tables retain active-generation rows. A partial module reload still
    # leaves all data reachable by the old request selector intact.
    rpc('permissions.addressReload')
    if kind != 'permissions':
        rpc('dispatcher.reload')
        loaded={int(value) for value in re.findall(r'\bID:\s*(\d+)',rpc('dispatcher.list'))}
        expected={bank*1000000+customer['id']+10 for customer in customers}
        if not expected.issubset(loaded): raise RuntimeError('Dispatcher omitted candidate destinations; previous selector retained')
        rpc('htable.reload','runtime')
    old_generation = state['bank'] + state['ip_bank']*2
    generation = (bank if kind!='permissions' else state['bank']) + ipbank*2
    changed = False
    try:
        rpc('htable.seti','active','generation',generation); changed=True
        with connection.cursor() as cur:
            cur.execute('UPDATE runtime_state SET ip_bank=%s,bank=%s WHERE id=1',(ipbank,bank if kind!='permissions' else state['bank']))
            for key,value in [('generation',generation)]:
                cur.execute('UPDATE runtime_selector SET key_value=%s WHERE key_name=%s',(str(value),key))
        connection.commit()
    except Exception:
        connection.rollback()
        if changed: rpc('htable.seti','active','generation',old_generation)
        raise

def main():
    last_expiry = 0
    bootstrap = True
    while True:
        connection = None
        request = None
        try:
            connection = connect()
            with connection.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute('SELECT pg_try_advisory_lock(7415060) AS acquired')
                if not cur.fetchone()['acquired']:
                    connection.rollback()
                    continue
                if bootstrap:
                    # Existing installations migrate in API startup. Do not
                    # consume the bootstrap request before that schema is ready.
                    cur.execute('SELECT 1 FROM behavior_rules LIMIT 1')
                    cur.execute('INSERT INTO runtime_requests(id,kind) VALUES(%s,%s)',(str(uuid.uuid4()),'all'))
                    bootstrap=False
                cur.execute('SELECT * FROM runtime_requests WHERE status IN (\'queued\',\'activating\') ORDER BY requested_at LIMIT 1')
                request = cur.fetchone()
                if not request and time.time()-last_expiry>15:
                    # Refresh expiring bans even with API down; never touch routes.
                    cur.execute('SELECT 1 FROM blocked_ips WHERE expires_at IS NOT NULL LIMIT 1')
                    if cur.fetchone():
                        request = {'id':str(uuid.uuid4()),'kind':'permissions'}
                        cur.execute('INSERT INTO runtime_requests(id,kind) VALUES(%s,%s)',(request['id'],'permissions'))
                    last_expiry=time.time()
                if request: cur.execute("UPDATE runtime_requests SET status='activating',message='Loading runtime caches' WHERE id=%s",(request['id'],))
            connection.commit()
            if request:
                sync(connection,request['kind'])
                with connection.cursor() as cur: cur.execute("UPDATE runtime_requests SET status='success',message='Runtime caches updated without restarting Kamailio',finished_at=now() WHERE id=%s",(request['id'],))
                connection.commit()
                print(f"{request['id']} success {request['kind']}",flush=True)
        except Exception as error:
            print(f'Runtime reload failed: {error}',flush=True)
            if connection:
                connection.rollback()
                if request:
                    try:
                        with connection.cursor() as cur: cur.execute("UPDATE runtime_requests SET status='failed',message='Previous active runtime generation retained',error=%s,finished_at=now() WHERE id=%s",(str(error)[:12000],request['id']))
                        connection.commit()
                    except Exception: connection.rollback()
        finally:
            if connection: connection.close()
        time.sleep(2)
    

if __name__ == '__main__':
    main()

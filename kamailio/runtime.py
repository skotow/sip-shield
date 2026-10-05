"""Process readiness and structured event journaling; runtime tables reload separately."""
import os
import pathlib
import subprocess
import time
import signal
import json
import uuid
import threading
import socket
from collections import deque

ROOT = pathlib.Path('/opt/sipshield')
SOCKET = 'unix:/rpc/kamailio.sock'

def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + str(uuid.uuid4()) + '.tmp')
    try:
        temporary.write_text(data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def render(target):
    text = (ROOT / 'kamailio.cfg').read_text()
    for name, default in [('LISTEN_PORT','5060'), ('BACKEND_HOST','host.docker.internal'), ('BACKEND_PORT','5070'), ('ADVERTISED_HOST','127.0.0.1')]:
        value = os.environ.get('SIP_' + name, default)
        if name.endswith('PORT'):
            if not value.isdigit() or not 1 <= int(value) <= 65535:
                raise ValueError('Invalid SIP_' + name)
        elif not value or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_' for c in value):
            raise ValueError('Invalid SIP_' + name)
        if name=='LISTEN_PORT':
            # Keep the template usable by older images on the default port.
            text=text.replace('advertise @ADVERTISED_HOST@:5060','advertise @ADVERTISED_HOST@:'+value)
        else:
            text = text.replace('@' + name + '@', value)
    from urllib.parse import quote
    url = os.environ.get('DATABASE_URL')
    if url:
        if not url.startswith(('postgres://','postgresql://')) or any(c in url for c in '\r\n"\\'):
            raise ValueError('DATABASE_URL must be a percent-encoded PostgreSQL URI')
        url=url.replace('postgresql://','postgres://',1)
    else:
        host=os.environ.get('PGHOST','postgres')
        port=os.environ.get('PGPORT','5432')
        if any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_' for c in host) or not port.isdigit():
            raise ValueError('Invalid PostgreSQL host/port')
        url='postgres://'+quote(os.environ.get('PGUSER','sipshield'),safe='')+':'+quote(os.environ['PGPASSWORD'],safe='')+'@'+host+':'+port+'/'+quote(os.environ.get('PGDATABASE','sipshield'),safe='')
    text = text.replace('@DB_URL@',url)
    atomic(target, text)

def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()

def sip_ready():
    # Any response to our own OPTIONS proves routing workers are running.
    # Generated security rules may legitimately return 403 instead of 200.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.bind(('127.0.0.1', 0))
        probe.settimeout(0.3)
        port = probe.getsockname()[1]
        call = str(uuid.uuid4())
        message = (f'OPTIONS sip:readiness.invalid SIP/2.0\r\n'
                   f'Via: SIP/2.0/UDP 127.0.0.1:{port};branch=z9hG4bK-{call};rport\r\n'
                   'Max-Forwards: 10\r\nFrom: <sip:probe@readiness.invalid>;tag=ready\r\n'
                   'To: <sip:probe@readiness.invalid>\r\n'
                   f'Call-ID: {call}\r\nCSeq: 1 OPTIONS\r\nContent-Length: 0\r\n\r\n')
        probe.sendto(message.encode(), ('127.0.0.1', 5060))
        try:
            response = probe.recv(8192)
            return response.startswith(b'SIP/2.0 ') and call.encode() in response
        except socket.timeout:
            return False

def start(config, log=None):
    import trace_capture
    trace_capture.start()
    lines = deque(maxlen=200)
    process = subprocess.Popen(['kamailio','-DD','-E','-f',str(config)], start_new_session=True,
                               stdout=log if log is not None else subprocess.PIPE,
                               stderr=log if log is not None else subprocess.STDOUT, text=True)
    if log is None:
        def forward():
            for line in process.stdout:
                lines.append(line)
                print(line, end='', flush=True)
                marker='SIPSHIELD_EVENT '
                if marker in line:
                    try:
                        import datetime
                        record=json.loads(line.split(marker,1)[1])
                        name=datetime.datetime.now(datetime.timezone.utc).strftime('events-%Y%m%d%H.jsonl')
                        with open('/logs/'+name,'a') as journal: journal.write(json.dumps(record)+'\n')
                    except Exception as error: print(f'Event journal write failed: {error}',flush=True)
        threading.Thread(target=forward, daemon=True).start()
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('Kamailio exited during startup')
            result = subprocess.run(['kamcmd','-s',SOCKET,'core.uptime'], capture_output=True, timeout=2)
            if result.returncode == 0:
                time.sleep(0.15)
                if process.poll() is None and sip_ready():
                    return process
            time.sleep(0.1)
        raise RuntimeError('Kamailio RPC readiness timed out')
    except Exception as error:
        stop(process)
        if lines:
            raise RuntimeError(f'{error}\n{"".join(lines)[-12000:]}') from error
        raise

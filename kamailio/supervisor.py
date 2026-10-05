"""Forward process logs to stdout/journal, without config reload machinery."""
import os,pathlib,signal,time
from runtime import render,start,stop
running=True
def shutdown(signum,frame):
    global running
    running=False
signal.signal(signal.SIGTERM,shutdown)
signal.signal(signal.SIGINT,shutdown)
config=pathlib.Path(os.environ.get('KAMAILIO_RENDERED_CONFIG','/tmp/kamailio.cfg'))
render(config)
process=start(config)
try:
    while running:
        if process.poll() is not None: raise RuntimeError('Kamailio exited')
        time.sleep(0.2)
finally:
    stop(process)

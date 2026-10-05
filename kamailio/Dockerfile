FROM ghcr.io/kamailio/kamailio:6.0.7-trixie
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-psycopg2 && rm -rf /var/lib/apt/lists/*
COPY kamailio.cfg /opt/sipshield/kamailio.cfg
COPY entrypoint.sh /entrypoint.sh
COPY runtime.py supervisor.py trace_capture.py /opt/sipshield/
COPY table_worker.py collector.py table_worker_connection.py /opt/sipshield/
COPY test_worker.py test_trace.py test_runtime.py /opt/sipshield/
ENTRYPOINT ["sh", "/entrypoint.sh"]

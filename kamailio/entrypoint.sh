#!/bin/sh
set -eu
# Validate substitutions before passing them into the SIP configuration.
case "$SIP_BACKEND_HOST" in ''|*[!A-Za-z0-9._-]*) echo 'Invalid SIP_BACKEND_HOST' >&2; exit 1;; esac
case "$SIP_ADVERTISED_HOST" in ''|*[!A-Za-z0-9._-]*) echo 'Invalid SIP_ADVERTISED_HOST' >&2; exit 1;; esac
case "$SIP_BACKEND_PORT" in ''|*[!0-9]*) exit 1;; esac
[ "$SIP_BACKEND_PORT" -ge 1 ] && [ "$SIP_BACKEND_PORT" -le 65535 ]
sed -e "s/@BACKEND_HOST@/$SIP_BACKEND_HOST/g" -e "s/@BACKEND_PORT@/$SIP_BACKEND_PORT/g" -e "s/@ADVERTISED_HOST@/$SIP_ADVERTISED_HOST/g" /opt/sipshield/kamailio.cfg > /tmp/kamailio.cfg
mkdir -p /rpc /logs
exec python3 /opt/sipshield/supervisor.py

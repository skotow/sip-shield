#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v docker >/dev/null || { echo 'Docker is not installed.' >&2; exit 1; }
docker compose version >/dev/null || { echo 'Docker Compose v2 is required.' >&2; exit 1; }
docker compose -f docker-compose.yml down
echo 'Containers stopped. Persistent volumes and .env have been kept.'
echo 'Deleting volumes permanently removes customers, rules, events, logs and runtime state.'
# Prompt from the terminal; piped/noninteractive runs always preserve data.
if [[ -t 0 ]]; then
  read -r -p 'Type DELETE to permanently remove this stack’s volumes: ' answer
  if [[ $answer == DELETE ]]; then
    docker compose -f docker-compose.yml down --volumes
    echo 'Compose volumes deleted. .env and repository files have been kept.'
  else echo 'Data preserved.'; fi
else echo 'No interactive confirmation available; data preserved.'; fi

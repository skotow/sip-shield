#!/usr/bin/env bash
set -euo pipefail
umask 077

# Piped execution downloads the repository first; never overwrite an existing dir.
if [[ -n ${BASH_SOURCE[0]:-} && -f ${BASH_SOURCE[0]} ]]; then
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
elif [[ ! -f docker-compose.yml || ! -f .env.example ]]; then
  command -v git >/dev/null || { echo 'Install Git to use the quick installer.' >&2; exit 1; }
  destination=${SIPSHIELD_INSTALL_DIR:-sip-shield}
  [[ ! -e $destination ]] || { echo "Directory $destination already exists; run its ./install.sh instead." >&2; exit 1; }
  git clone https://github.com/skotow/sip-shield.git "$destination"
  cd -- "$destination"
fi
command -v docker >/dev/null || { echo 'Install Docker Engine/Desktop first.' >&2; exit 1; }
docker compose version >/dev/null || { echo 'Install the Docker Compose v2 plugin first.' >&2; exit 1; }
docker info >/dev/null || { echo 'Start Docker and check your Docker permissions.' >&2; exit 1; }
[[ -f .env ]] || cp .env.example .env
chmod 600 .env
# Never source .env: it is configuration, not shell code.
get_value() {
  local value
  value=$(sed -n "s/^$1=//p" .env | tail -n 1)
  value=${value%$'\r'}
  if [[ $value == \"*\" || $value == \'*\' ]]; then value=${value:1:${#value}-2}; fi
  printf '%s' "$value"
}
random_secret() {
  # 32 bytes of system randomness, encoded without shell/Compose metacharacters.
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}
ensure_secret() {
  local key=$1 minimum=$2 value temporary
  value=$(get_value "$key")
  if [[ -z $value ]]; then
    value=$(random_secret)
    [[ ${#value} == 64 ]] || { echo 'Could not generate secure randomness.' >&2; exit 1; }
    temporary=$(mktemp .env.tmp.XXXXXX)
    awk -v key="$key" -v value="$value" 'BEGIN {found=0} $0 ~ "^" key "=" {if(!found)print key "=" value; found=1; next} {print} END {if(!found)print key "=" value}' .env > "$temporary"
    mv -- "$temporary" .env
    echo "Generated $key in .env."
  elif [[ ${#value} -lt $minimum ]]; then
    echo "$key is too short (minimum $minimum characters). Update .env; existing credentials were not changed." >&2
    exit 1
  fi
}
# Existing DB passwords must remain unchanged, even on upgrades.
ensure_secret POSTGRES_PASSWORD 1
ensure_secret ADMIN_PASSWORD 16
ensure_secret SESSION_SECRET 32
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d
dashboard_port=$(get_value DASHBOARD_PORT); dashboard_port=${dashboard_port:-3000}
api_port=$(get_value API_PORT); api_port=${api_port:-8080}
sip_port=$(get_value SIP_LISTEN_PORT); sip_port=${sip_port:-5060}
echo "Dashboard: http://localhost:$dashboard_port"
echo "API health: http://localhost:$api_port/health"
echo "SIP: UDP/TCP $sip_port (localhost by default)."
echo 'Dashboard/API are localhost-bound by default. On a remote server use an SSH tunnel.'
echo 'Sign in with ADMIN_USER (default admin) and ADMIN_PASSWORD from your private .env.'
echo 'Add your customer domain and PBX backend, then Apply SIP Config.'
echo 'Before remote SIP use, set SIP_ADVERTISED_HOST, SIP_BIND_ADDRESS and firewall rules.'
echo 'Keep .env private. Inspect startup with: docker compose logs -f'

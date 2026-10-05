#!/usr/bin/env bash
# Installer safety checks with a fake Docker CLI; never touch the real stack.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
mkdir "$temporary/bin" "$temporary/instance"
cp "$root/install.sh" "$root/uninstall.sh" "$root/.env.example" "$temporary/instance/"
touch "$temporary/instance/docker-compose.yml"
export DOCKER_TEST_LOG="$temporary/docker.log"
cat > "$temporary/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_TEST_LOG"
if [[ $* == *pull* && ${FAIL_PULL:-0} == 1 ]]; then exit 1; fi
MOCK
chmod +x "$temporary/bin/docker"
export PATH="$temporary/bin:$PATH"
cd "$temporary/instance"
bash -n install.sh uninstall.sh
bash install.sh > "$temporary/output"
for key in POSTGRES_PASSWORD ADMIN_PASSWORD SESSION_SECRET; do
  grep -Eq "^$key=[0-9a-f]{64}$" .env
done
[[ $(stat -c %a .env) == 600 ]]
before=$(sha256sum .env)
bash install.sh > "$temporary/output"
[[ $(sha256sum .env) == "$before" ]]
grep -q 'config --quiet' "$DOCKER_TEST_LOG"
grep -q 'docker-compose.yml pull' "$DOCKER_TEST_LOG"
grep -q 'docker-compose.yml up -d' "$DOCKER_TEST_LOG"
! grep -Eq 'build|down' "$DOCKER_TEST_LOG"
# Values that resemble shell code must never be evaluated by the installer.
printf '\nTELEGRAM_CHAT_ID=$(touch SHOULD_NOT_EXIST)\n' >> .env
bash install.sh > "$temporary/output"
[[ ! -e SHOULD_NOT_EXIST ]]
# Uninstall without a terminal stops containers, but cannot delete volumes.
: > "$DOCKER_TEST_LOG"
printf 'DELETE\n' | bash uninstall.sh > "$temporary/output"
grep -q 'docker-compose.yml down' "$DOCKER_TEST_LOG"
! grep -q -- '--volumes' "$DOCKER_TEST_LOG"
# Even a populated invalid admin password is preserved rather than replaced.
sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=short/' .env
before=$(sha256sum .env)
: > "$DOCKER_TEST_LOG"
if bash install.sh > "$temporary/output" 2>&1; then echo 'Weak password incorrectly accepted'; exit 1; fi
[[ $(sha256sum .env) == "$before" ]]
! grep -q 'pull' "$DOCKER_TEST_LOG"
# A pull failure must not start a partial or stale stack.
sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=0123456789abcdef0123456789abcdef/' .env
: > "$DOCKER_TEST_LOG"
if FAIL_PULL=1 bash install.sh > "$temporary/output" 2>&1; then echo 'Pull failure incorrectly ignored'; exit 1; fi
! grep -q 'up -d' "$DOCKER_TEST_LOG"
# Exercise both interactive branches using a pseudo-terminal and the fake CLI.
python3 - <<'PY'
import os, pathlib, pty, subprocess
log=pathlib.Path(os.environ['DOCKER_TEST_LOG'])
for answer,deleted in [(b'KEEP\n',False),(b'DELETE\n',True)]:
    log.write_text('')
    master,slave=pty.openpty()
    try:
        process=subprocess.Popen(['bash','uninstall.sh'],stdin=slave,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        os.write(master,answer)
        output,error=process.communicate(timeout=10)
        assert process.returncode==0,error.decode()
        assert ('--volumes' in log.read_text())==deleted
    finally:
        os.close(master);os.close(slave)
PY
echo 'Installer checks passed: private/idempotent secrets, no env evaluation, fail-fast pull, and explicit interactive confirmation before volume deletion.'

<img width="1907" height="712" alt="image" src="https://github.com/user-attachments/assets/b75efed0-bb7e-4e0a-84ac-d2b903e5fcdf" />


# SIP Shield — production-lite runtime

SIP client/carrier → Kamailio → customer PBX. PostgreSQL stores management data and runtime tables. SIP requests use only Kamailio's in-memory caches: no API, Redis, or SQL query in the request path. RTPengine is deliberately outside this phase.

## Quick install

Docker Engine/Desktop with the Compose v2 plugin is required. Prebuilt releases currently target **Linux amd64**; ARM hosts are not supported by these published images yet. Run on Linux/macOS or Git Bash with Docker Desktop Linux containers. No local Node.js, Python or Kamailio setup is needed.

```bash
git clone https://github.com/skotow/sip-shield
cd sip-shield
./install.sh
```

The installer checks Docker, creates `.env` if missing, generates missing database/admin/session secrets from system randomness, pulls GHCR images, and starts the stack. Existing `.env` values and volumes are preserved; weak existing admin/session secrets cause a clear error rather than silently changing your login. It does not print passwords: read `ADMIN_PASSWORD` privately from `.env` and sign in as `admin`. Containers may take a few seconds to become ready; inspect `docker compose logs -f`.

Alternative quick install (requires Git and creates `./sip-shield`, without overwriting an existing directory):

```bash
curl -fsSL https://raw.githubusercontent.com/skotow/sip-shield/main/install.sh | bash
```

Review the script first if preferred. Use `SIPSHIELD_INSTALL_DIR` to choose another download directory. If downloaded scripts lack their executable bit, run `bash install.sh` or `chmod +x install.sh uninstall.sh`.

## Manual install

```bash
git clone https://github.com/skotow/sip-shield
cd sip-shield
cp .env.example .env
# Edit .env: set a unique POSTGRES_PASSWORD, ADMIN_PASSWORD (16+ characters)
# and SESSION_SECRET (32+ characters). Example generator: openssl rand -hex 32
chmod 600 .env
docker compose pull
docker compose up -d
```

Blank secret values intentionally prevent startup; use `./install.sh` for automatic generation. Never replace an existing `.env` during an upgrade. The default images are `ghcr.io/skotow/sip-shield-api:latest`, `sip-shield-dashboard:latest`, `sip-shield-kamailio:latest`, and `sip-shield-worker:latest` under the same namespace. Collector and reloader share the worker image. `GHCR_NAMESPACE` and `IMAGE_TAG` allow forks and pinned releases. For repeatable deployments use the same version tag (for example `v1.0.0`) or `sha-<full-git-sha>` for all images, and check out the corresponding repository revision for its config/migrations.

- Dashboard: http://localhost:3000 (login required)
- API health: http://localhost:8080/health
- SIP: localhost:5060 UDP/TCP initially

Ports are configurable through `API_PORT`, `DASHBOARD_PORT`, and `SIP_LISTEN_PORT`. API/dashboard stay on `127.0.0.1` by default. For remote installation use an SSH tunnel, for example `ssh -L 3000:127.0.0.1:3000 user@server`, then open localhost:3000 on your computer. No Docker socket is mounted in any service.

PostgreSQL initializes a fresh volume; the API applies additive runtime migrations to existing databases. Named volumes preserve database/Redis data, rendered Kamailio config (`kamailio-generated`), log journals/collector offsets (`sip-logs`), and the private runtime RPC socket (`runtime-rpc`). Durable reload requests, status, and active table generations live in PostgreSQL, not generated include files in this runtime-managed version. The API has no mount for RPC or rendered SIP config. PostgreSQL is required at cold startup; warm SIP workers keep forwarding if management services go down.

`POSTGRES_USER`, `POSTGRES_DB` and `POSTGRES_PASSWORD` configure the bundled database consistently for API, Kamailio and workers. Leave `DATABASE_URL` blank to derive that connection, or supply an equivalent PostgreSQL URI for the same bundled database (percent-encode reserved password characters). Do not change database name/user/password on an existing initialized volume without first migrating its database roles/data. `REDIS_URL` defaults to the bundled Redis. Optional Telegram variables provide defaults; dashboard-saved settings take precedence. Sessions use `SESSION_SECRET`, not JWT tokens.

## Updates and uninstall

```bash
docker compose pull
docker compose up -d
# Or rerun ./install.sh; existing credentials/data are kept.
./uninstall.sh
```

Uninstall first stops containers while preserving data. Volumes are removed only after you interactively type `DELETE`; noninteractive runs always preserve them. `.env` and repository files are never deleted. Back up PostgreSQL before upgrades. Updating image/native config revisions can recreate Kamailio and interrupt SIP transactions, so schedule an upgrade window. Normal dashboard policy changes still reload runtime tables without restarting SIP.

## Development

The standalone development file builds local sources and never requires SIP Shield images from GHCR:

```bash
cp .env.example .env  # only if .env does not already exist
# Set the three secrets as described above.
docker compose -f docker-compose.dev.yml up --build
```

Use `-f docker-compose.dev.yml` for subsequent build/up commands. This file shares base service configuration and the same project volumes; do not run production and development as two simultaneous stacks on the same ports/data. Node.js is needed only for local frontend/API development or the integration scripts, not installation.

## Publishing releases (maintainer)

`.github/workflows/docker.yml` builds and pushes all four images on `main`, `v*` tags, and manual dispatch. Tags are `latest` only for main, `sha-<full-git-sha>` for every build, and both `v1.0.0` / `1.0.0` for a semantic version tag. It uses the repository owner automatically, lowercases the registry namespace, logs in using `GITHUB_TOKEN`, and grants `contents: read` / `packages: write`. No registry password is stored in the repo. Linux amd64 is the currently tested platform.

**Before advertising public installation:** push this repository to `skotow/sip-shield`, let all four build jobs succeed, then make all four GHCR packages **public**. GHCR packages are private on first publication; anonymous pulls fail until visibility is changed. See [GitHub Container Registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). This workspace does not itself publish images. Verify `docker compose pull` on a clean machine without registry login. Fork maintainers must adjust `.env.example`, repository URLs, and installer clone URL.

Track script executable modes once before committing from Windows: `git update-index --chmod=+x install.sh uninstall.sh`. `.gitattributes` keeps shell scripts LF-terminated. Workflow builds are independently published; wait for every image job before selecting a new SHA/version. A failed partial build should not be treated as a release.

## Deployment security

- Use a unique strong admin password and rotate it when access changes; keep `.env` private and out of Git/backups shared publicly.
- Do not expose dashboard/API without HTTPS, existing authentication, and firewall/VPN restrictions. Set `COOKIE_SECURE=true` behind HTTPS. `MANAGEMENT_BIND_ADDRESS` defaults to loopback; exposing it is an explicit deployment choice.
- For remote SIP set `SIP_BIND_ADDRESS=0.0.0.0`, `SIP_ADVERTISED_HOST` to the reachable host/IP, and permit UDP/TCP 5060 (or your chosen port) only from the sources you need. Test locally first.
- The backend PBX should accept SIP only from SIP Shield's network source IP. This avoids bypassing gateway security and makes the source visibility headers trustworthy.
- Media still flows directly between client and PBX; this release does not configure RTPengine, TLS termination for SIP, or a complete production firewall/HA deployment.

## Support

GitHub Sponsors: `https://github.com/sponsors/skotow` (placeholder). Custom donations: `https://revolut.me/nazar333h`. Commercial installation/support contact: `support@tabydial.com`.

## Backend and registration

For a PBX on the Docker host use `host.docker.internal:5070`. Edit the seeded Demo PBX backend from `127.0.0.1` accordingly: loopback addresses refer to the Kamailio container. For a remote PBX use its reachable hostname/IPv4 and SIP port. Backend hostnames must resolve during updates. The static fallback uses SIP_BACKEND_HOST/SIP_BACKEND_PORT from `.env`.

A customer domain matches the SIP request-URI domain, case-insensitively. Adding a domain does not configure DNS or make the backend accept that domain. For a backend that requires its original registration domain, retain that domain in the phone and customer row, and use SIP Shield as the outbound proxy. Backend credentials remain with the PBX.

SIP ports remain loopback-bound for local tests. For LAN/public deployment set SIP_BIND_ADDRESS=0.0.0.0, set SIP_ADVERTISED_HOST to a reachable address, and configure firewall/NAT. Media still flows directly between client and PBX; registration success does not guarantee working audio.

## Test locally without a VPS or public domain

You can test on your own computer with a softphone and a local/LAN SIP PBX. A hosts-file entry makes a test domain resolve to SIP Shield without purchasing a domain or creating public DNS records. **You still need a reachable SIP registrar/PBX and valid extension credentials:** SIP Shield forwards registration requests; it does not create SIP accounts or register users itself.

### 1. Start SIP Shield on your computer

Install as described above, or use the development Compose file for local source builds. Keep these values in `.env` for a softphone on the same computer:

```env
SIP_BIND_ADDRESS=127.0.0.1
SIP_ADVERTISED_HOST=127.0.0.1
SIP_LISTEN_PORT=5060
```

Open the dashboard at `http://localhost:3000` (or your configured dashboard port). If you change `.env`, recreate the affected service with `docker compose up -d`, or `docker compose -f docker-compose.dev.yml up -d` for development. Make sure your PBX and softphone do not also bind the host's SIP port 5060. For example, run the local PBX on 5070 and let the softphone choose an automatic local port, or use 5062.

### 2. Point a test domain to SIP Shield in the hosts file

Edit the hosts file **on the computer running the softphone**, using administrator/root permissions:

| Operating system | Hosts file |
|---|---|
| Windows | `C:\Windows\System32\drivers\etc\hosts` (open your editor as Administrator) |
| Linux / macOS | `/etc/hosts` (for example, `sudo nano /etc/hosts`) |

Add this line for SIP Shield running on the same computer:

```text
127.0.0.1 sipshield.test
```

Save the file (on Windows, keep the filename `hosts`, without a `.txt` extension), then restart the softphone to clear its cached lookup. This entry only affects that computer; it does not create public DNS. A hosts file maps a hostname to an IP, not a port.

### 3. Add the matching customer and real backend

In **Customers**, add:

| Field | Example |
|---|---|
| Name | Local test PBX |
| Domain | `sipshield.test` |
| Backend host | `host.docker.internal` for a PBX on the Docker host, or your PBX's LAN IP |
| Backend port | `5070` for this example; use the port your PBX actually listens on |
| Enabled | Yes |

The backend must be listening on an interface reachable from the Kamailio container, not only the host's loopback interface. Do not use `127.0.0.1` as the backend host for a PBX outside the container; it would point back into Kamailio's container. Click **Apply SIP Config** and wait for a successful runtime update.

**Configure the PBX to accept the SIP domain `sipshield.test`.** Routing a domain through SIP Shield does not make the PBX recognize that domain. If an existing PBX requires its original SIP domain, keep that original domain in the customer row and softphone account, and set the softphone's outbound proxy to `sipshield.test:5060`. The hosts entry then resolves the proxy while the SIP Request-URI retains the backend's required domain. Do not point the test hostname at the backend directly; that would bypass SIP Shield.

### 4. Register from your softphone

For a PBX configured to accept `sipshield.test`, use:

| Softphone setting | Value |
|---|---|
| SIP domain / account server | `sipshield.test` |
| Server port | `5060` (or your `SIP_LISTEN_PORT`) |
| Transport | UDP or TCP; TLS is not configured in this local setup |
| Username / extension | A real extension configured on your PBX, for example `100` |
| Authentication username | The authentication ID required by your PBX |
| Password | That extension's PBX password, not the SIP Shield dashboard password |
| Outbound proxy, if required by the softphone | `sipshield.test:5060` |

The expected path is **softphone → `sipshield.test` → SIP Shield → backend PBX**. A backend `401 Unauthorized` authentication challenge can be normal; successful registration typically finishes with a backend `200 OK`. In **Events / SIP Explorer**, inspect REGISTER requests and backend replies. A gateway **Allowed** decision only means forwarding was permitted; it does not prove the PBX accepted registration. A backend `403 URI domain not configured locally, relaying forbidden` means you need to correct the backend domain/account configuration.

Inspect logs with:

```bash
docker compose logs -f kamailio collector reloader
```

### Testing from another computer on your LAN

Use the SIP Shield computer's LAN IP instead of loopback, for example:

```text
192.168.1.50 sipshield.test
```

Add that hosts entry on each softphone computer. On the SIP Shield computer set `SIP_BIND_ADDRESS=0.0.0.0` and `SIP_ADVERTISED_HOST=192.168.1.50`, then recreate Kamailio. Permit the chosen SIP UDP/TCP port through the host firewall only for the LAN clients you intend to test. API/dashboard can remain localhost-bound. Other devices' `127.0.0.1` refers to themselves, not your SIP Shield computer.

This tests SIP registration, filtering, and forwarding. RTP/media still flows directly between the softphone and PBX; this guide does not configure a media relay or guarantee working audio. Remove the test hosts entry when finished, especially if you temporarily overrode an existing hostname.

## Original source visibility

Forwarded backend requests contain fresh `X-SIPShield-Source-IP`, `X-SIPShield-Source-Port`, `X-SIPShield-Transport`, and `X-SIPShield-Decision: allowed` headers. `X-SIPShield-Customer` contains the matched customer domain when one exists; unmatched fallback requests omit it. `X-Original-Source-IP` is a compatibility alias enabled by default. All inbound `X-SIPShield-*` and `X-Original-Source-IP` headers are removed before fresh values are appended, including duplicates and case variations. Blocked replies and locally answered OPTIONS do not get these headers. Reverse dialog requests toward clients are not enriched.

The backend's **network source IP remains SIP Shield's IP**. PBX captures/VoIPmonitor can inspect the trusted headers to identify the source observed by SIP Shield. `$si`/`$sp` are the inbound socket IP/port; if a NAT or another proxy precedes SIP Shield, they identify that hop. Docker Desktop may present the Docker gateway IP in local tests. We do not trust client-supplied Via or identity headers to infer a different source. Backend systems should trust these headers only on traffic arriving from SIP Shield and restrict direct SIP access accordingly.

For example, an INVITE from `198.51.100.25:51810` over UDP to the configured customer domain `sip.nazar.com` arrives at the backend with:

```sip
INVITE sip:100@sip.nazar.com SIP/2.0
X-SIPShield-Source-IP: 198.51.100.25
X-SIPShield-Source-Port: 51810
X-SIPShield-Transport: udp
X-SIPShield-Decision: allowed
X-SIPShield-Customer: sip.nazar.com
X-Original-Source-IP: 198.51.100.25
```

The example IP is illustrative; the test uses the actual observed source. Run `node scripts/source-headers-smoke.mjs` against the local stack (Node.js and free UDP port 5074 required). It sends duplicate/case-varied spoofed headers over UDP and TCP, captures forwarded INVITEs and REGISTERs at a test backend, verifies replacement and that blocked/local replies are not enriched, then removes its temporary customer. Transparent proxying/TPROXY is advanced network configuration and is not part of this MVP. Changing this native header-processing route requires a planned Kamailio restart; common dashboard rule changes still use runtime caches.

## Runtime architecture

| Component | Responsibility |
|---|---|
| API/React | Authenticated CRUD and durable update requests |
| PostgreSQL `address` | permissions-compatible IP/CIDR entries, with policy groups and generation metadata |
| PostgreSQL `dispatcher` | Customer backend URI and dispatcher set IDs |
| PostgreSQL `runtime_kv` | Domain-to-customer maps, UA/prefix filters and behavior policies, loaded into htable |
| `reloader` worker | Validates/synchronizes inactive table generations and invokes local module RPCs |
| Kamailio | Cached routing/filtering, behavior counters, Pike and expiring htable bans |
| `collector` worker | Reads persistent JSON journal and inserts real `sip_events` |

Customer CRUD automatically queues route/filter updates. IP rule edits queue permissions-only updates. UA/prefix edits queue full runtime-table updates. **Apply SIP Config** explicitly queues a full runtime update; it no longer generates native includes or restarts SIP processes. Observe last update status in the dashboard. Events/overview refresh automatically every five seconds.

Runtime endpoints (authentication required):

- `POST /api/apply-config`: synchronize runtime tables and reload permissions, dispatcher and map/filter htable.
- `POST /api/reload-permissions`: synchronize/reload IP permissions only; dispatcher is not reloaded.
- `GET /api/reload-status`: latest durable queued/activating/success/failed update.
- `GET /api/reload-status?id=<uuid>`: exact update outcome.

The permissions module loads `address` into memory and matches source IPs/CIDRs with `allow_source_address`. SIP Shield interprets matching block groups as denial; allow groups provide exceptions to IP blocks. The function name itself does not determine policy. [permissions documentation](https://www.kamailio.org/docs/modules/6.0.x/modules/permissions.html)

Each customer maps to dispatcher `setid = route_bank * 1000000 + customer_id + 10`; htable caches the domain-to-customer map. Kamailio selects from that set with `ds_select_dst`. Unknown domains keep the configured static fallback. A matched customer with an unavailable set receives 503 instead of silently falling back. [dispatcher documentation](https://www.kamailio.org/docs/modules/6.0.x/modules/dispatcher.html)

## Safe updates and outages

Two generations of IP and routing data coexist. The worker holds a PostgreSQL advisory lock for the whole update, writes only the inactive generation, then calls `permissions.addressReload`, `dispatcher.reload`, and `htable.reload runtime` as appropriate. DNS preflight and dispatcher-set verification catch omitted destinations. Only after all required reloads succeed does one `htable.seti active generation` atomically select the new IP/route generations. Every SIP request captures that selector once. Cached data for the previous generation remains available during a partial reload. A module reload error leaves the old selector active and reports failure; it never terminates Kamailio. Runtime RPC uses a private shared Unix socket, without Docker socket, network control endpoint, or API access to the socket.

Generation selectors are persisted for warm restarts. The API's source rows are desired configuration: a failed activation does not undo customer edits, so fix the input and retry Apply. IP-only updates use the active domain map and do not activate pending customer-route changes. Worker restart attempts reconciliation again.

PostgreSQL/API/Redis downtime does not stop existing cached forwarding/filtering. The worker retries database availability; reload failures preserve the active generation. New management changes cannot be saved without PostgreSQL. Kamailio restart during a database outage is not supported: this is warm-runtime resilience, not offline cold boot or HA. Dispatcher destinations should use reliable DNS; this architecture does not eliminate DNS dependence.

## IP and other security rules

### Bulk destination-prefix CSV import

In **Rules → Destination prefixes**, download the CSV template, choose a UTF-8 comma-separated CSV file and a scope (global or one customer), then click **Import CSV**. The required header is `prefix`; `reason` is optional:

```csv
prefix,reason
00900,Premium-rate destinations
+1900,Restricted destinations
```

Keep spreadsheet prefix columns formatted as text to preserve leading zeros and `+`. Valid prefixes contain 1–64 digits or `+`, `*`, `#`; reasons are at most 512 characters. Quoted commas/newlines and UTF-8 BOM are supported. Each upload is limited to 1,000 data records / 1 MiB. All records must be valid before anything is saved. Duplicates within the upload or existing rules in the same scope are skipped; existing reasons are not overwritten. The first occurrence wins within a file. Prefixes in different scopes remain separate rules.

Import automatically queues one runtime-table update and displays its outcome. Saved does not mean active until that update succeeds; if it fails, previous active policies remain in use. Correct the reported issue and retry **Apply SIP Config**. An all-duplicate upload queues no update. Disabled customers' rules remain inactive until that customer is enabled.

Authenticated API: `POST /api/rules/prefixes/import` with `Content-Type: text/csv` and CSV as the raw body; optional `?customer_id=<id>` selects a customer, otherwise the import is global. Response includes `imported`, `skipped`, and `reload_id` for polling `/api/reload-status?id=...`. CSV imports and their reload request commit together. Verify against a local test stack with `node scripts/prefix-import-smoke.mjs` (requires free UDP port 5078).

- Exact IPv4/IPv6 and subnet CIDRs are supported. `/0` networks are represented by two `/1` entries because permissions treats mask 0 as a host mask.
- Global rules apply to all requests. Customer rules apply to the request-URI domain's active customer. Domain scope is not authenticated tenant identity; an in-dialog URI may use another domain.
- Global/customer allow entries override IP block entries and bypass Auto Defense counters, temporary bans and Pike flood protection. They do not bypass scanner, UA/prefix or Max-Forwards checks.
- Expiring IP rules are pruned by a background permissions refresh approximately every 15 seconds plus queue/retry delay. Expiry can be delayed during a DB outage; existing cached bans remain until a successful refresh.
- UA patterns are printable ASCII, literal, case-insensitive substrings. Backslash and caret are rejected. Regex punctuation is encoded as POSIX literal character classes. Prefixes accept digits, `+`, `*`, `#` (max 64 characters).
- Built-in scanner rejection and Max-Forwards checks remain. Pike detection inserts a 120-second local htable ban. Redis is not consulted by SIP workers.
- Disabled customers are omitted from runtime maps; their unmatched domains can still reach fallback. This is not an authenticated tenant isolation system.

## Auto Defense

Open **Auto Defense** to add/edit/disable behavior rules and view real auto-blocks or `would_block` alerts. Changes queue a runtime htable update automatically; **Apply SIP Config** retries activation. No API/SQL call occurs during enforcement and no process reload is needed for threshold changes. Existing temporary bans remain until expiry even when the originating rule is disabled or deleted; an activated allowlist entry immediately bypasses them.

| Initial rule | Threshold/window | Temporary ban |
|---|---|---|
| INVITE flood | 100 new INVITEs / 1 second | 10 minutes |
| REGISTER burst | 30 REGISTERs / 60 seconds | 30 minutes |
| OPTIONS flood | 200 OPTIONS / 60 seconds | 10 minutes |
| Backend 404 scan | 50 replies / 60 seconds | 30 minutes |
| Backend 403 failures | 30 replies / 60 seconds | 30 minutes |

These defaults are enabled in block mode on the first migration only. New dashboard rules default to **alert_only**. All thresholds, windows and ban durations are editable. REGISTER volume is a burst heuristic, not proof of incorrect credentials; failed authentication detection is not implemented. Large NATs and busy carriers need tuned thresholds and an IP/CIDR **Allow** rule before live use.

Rules support `invite`, `register`, `options`, `response_404` and `response_403`; global and customer rules both apply. CRUD endpoints are `GET/POST /api/behavior-rules` and `PUT/DELETE /api/behavior-rules/:id`, authenticated like other management endpoints. `GET /api/auto-defense/events` returns the latest 100 auto decisions and temporary-ban rejections.

Kamailio uses locked per-rule/source-IP htable counters with fixed windows starting at the first counted message. Reaching the threshold emits one decision per window. Editing a rule increments its revision and starts fresh counters; routine Apply does not clear counters. `tempban` stores source IPs with configurable expiry and an explicit deadline; matching untrusted requests receive **403 Temporarily Blocked**. Bans are source-wide, even if triggered by a customer-specific rule. A customer-scoped allow bypasses protection only for that customer; a global allow bypasses it everywhere. Allowlisted sources skip both counting and enforcement, including backend-response counters.

Backend 403/404 detection uses transaction-associated original client IP/customer/method, never the backend's source IP. Retransmitted terminal failures are deduplicated for 120 seconds; local firewall 403 responses are not counted as backend failures. New INVITEs exclude in-dialog re-INVITEs. Requests belonging to an existing TM transaction are skipped; locally answered stateless OPTIONS packets each count, including retransmissions. Counter state and bans are local to one Kamailio instance, survive management downtime, and reset when Kamailio restarts. Fixed windows use integer seconds and can miss bursts crossing a boundary. Customer scope follows the request-URI domain, not authenticated identity. Existing independent Pike protection can block earlier than an editable rule; alert-only changes only that behavior rule, not other security policies.

Auto-decision JSON includes source IP, method, optional response code, action (`blocked`/`would_block`), reason, rule ID, threshold, window seconds and block seconds. The existing persistent journal/collector stores these fields in `sip_events`; Auto Defense refreshes every five seconds. Subsequent rejected packets are logged as `temporary_behavior_ban` without a new threshold decision. No automatic permanent database IP blocks are created.

Implementation uses Kamailio's [htable locking and item expiry](https://www.kamailio.org/docs/modules/6.0.x/modules/htable.html).

## Real events and logs

Kamailio emits `SIPSHIELD_EVENT` followed by JSON constructed with jansson, including customer ID, source IP, method, users, UA, destination, action and reason. Request-controlled text is JSON escaped. The process log reader writes hourly JSONL journals on the persistent `sip-logs` volume; the collector inserts events into PostgreSQL with a unique event key and durable offsets. A DB outage leaves the journal queued; reconnect resumes ingestion without duplicate rows. Dashboard events/statistics now show actual SIP decisions.

```sh
docker compose logs -f kamailio
docker compose logs -f reloader
docker compose logs -f collector
```

Allowed means accepted for forwarding, not completed registration or answered call. No credentials/Authorization headers are logged. Collecting is asynchronous and best effort at the logging boundary; disk failure or a crash before journal persistence can lose events. Journals and event tables currently require operator retention/rotation and disk monitoring. Collector restart replays safely; restoring offsets/database separately can change replay behavior. One collector instance is supported.

## Event signaling explorer

In **Events**, the latest 100 sessions appear as one row per Call-ID, ordered by latest activity. Methods and individual decisions are shown inside **View signaling** rather than repeated as separate list rows. Each session includes a decision count; legacy events without a Call-ID remain separate. Search by IP, method, user, reason or Call-ID. Click a row or **View signaling** to open:

- **Diagram:** an interactive SIP ladder showing actual source/destination hops, request/response labels, CSeq, transport, message sizes and elapsed time. Select an arrow to inspect that message.
- **Messages:** sanitized SIP headers for incoming and outgoing requests and replies. Outgoing requests include SIP Shield's trusted source headers.
- **Decisions:** allowed/blocked/alert decisions sharing the event's Call-ID.

The popup refreshes every three seconds. Events created before capture was enabled may have decisions without signaling; the UI reports that explicitly. Call-ID is the correlation key, not proof of caller identity. For bounded queries, messages are limited to 24 hours either side of the selected event and the earliest 500 rows; the diagram draws the first 200. Reused/colliding Call-IDs can combine separate conversations. Captured retransmissions are shown rather than fabricated or deduplicated network hops. Gateway labels represent observed local gateway sockets; other lanes show actual observed IP/port/transport, including NAT/proxy addresses.

Kamailio's [siptrace core mirroring](https://www.kamailio.org/docs/modules/6.0.x/modules/siptrace.html) sends incoming/outgoing signaling as HEP3 to a private UDP listener on `127.0.0.1:9060` inside its container. No capture port is published. The receiver runs alongside the Kamailio supervisor, redacts before writing hourly `traces-*.jsonl` journals, and the existing collector inserts `sip_messages` into PostgreSQL with durable offsets and unique replay keys. API/dashboard access remains authenticated. No SIP request calls SQL/Redis/API; PostgreSQL/collector downtime queues captured messages on disk while forwarding continues.

This is a sanitized signaling explorer, not PCAP export. Authentication/challenge and unknown header values are replaced with `[redacted]`; folded headers are unfolded before filtering, SIP URI passwords are redacted, and message bodies (including SDP) are omitted. Common topology/identity headers remain visible. Each stored message display is bounded to 16 KiB and indicates truncation. As with other journals, disk monitoring and retention are operator responsibilities; `sip_messages` and trace journals grow with traffic. HEP duplication is best effort: UDP saturation, disk failure, oversized datagrams or a process crash can lose captures without stopping SIP forwarding. A cold restart is required to change capture modules/configuration; common security and route changes still use runtime tables.

No audio recording, RTP streams, MOS/jitter/loss analysis, packet downloads or SIP-user authentication is provided in this phase. RTPengine and media visibility remain a later phase.

Test on a local stack with Node.js and free UDP port 5075:

```sh
node scripts/call-flow-smoke.mjs
docker compose exec -T kamailio python3 /opt/sipshield/test_trace.py
```

The smoke test creates/removes an isolated customer and verifies real client/gateway/backend hops, backend 401/200 and local 403 responses, credential/body redaction, Call-ID grouping, trusted source headers and authenticated detail access. Its captured test events remain visible for inspecting the diagram.

## Management authentication

All `/api` management routes require a signed eight-hour session cookie except login/logout/session checks. Cookies are HttpOnly and SameSite=Strict. Password checks use scrypt; login attempts are limited locally, without requiring Redis. Browser writes require same-origin requests. Dashboard uses the same-origin reverse proxy and has sign-in/sign-out. Direct API clients first POST `/api/auth/login` with username/password, then retain the returned cookie. POST `/api/auth/logout` clears the browser cookie.

Before exposing management beyond localhost, use HTTPS, set COOKIE_SECURE=true, choose unique strong credentials/secrets, restrict access through firewall/VPN, and configure a trusted reverse proxy. Do not expose the raw API over plaintext HTTP. This phase provides a single admin account, no MFA/RBAC, and stateless signed sessions; rotating SESSION_SECRET revokes all existing sessions. Logout clears the client's cookie but does not revoke a copied cookie before expiry. Database credentials and Telegram tokens remain local secrets; separate least-privilege DB roles and a secret store are future hardening.

## Checks

Installer safety checks (mock Docker only): `bash scripts/test-install.sh` on Linux with Python 3. Runtime rendering checks: `python3 kamailio/test_runtime.py` with the worker's dependencies installed, or run it in the worker image. These cover secret preservation, config rendering, and explicit confirmation before removing volumes.

```sh
# API unit tests (including authentication)
cd api
npm ci
npm test
# Dashboard compilation
cd ../dashboard
npm ci
npm run build
# From project root, against a local test stack:
node scripts/runtime-smoke.mjs
# Auto Defense integration (requires free UDP port 5073):
node scripts/defense-smoke.mjs
```

The integration test requires free host ports 5071/5072. It uses `.env` credentials, creates/removes isolated test records, verifies real forwarding/blocking, authentication, events, failed permissions reload preservation and unchanged SIP worker PIDs. It briefly stops PostgreSQL, Redis and API to verify cached forwarding, then restores them. Do not run it against live production traffic. Old smoke entry points delegate to this runtime test; native include/restart workflows are retired.

The Auto Defense test creates isolated low-threshold customer rules, exercises alert-only, runtime edits, temporary ban expiry, CIDR allowlist bypass, backend 403/404 attribution and event ingestion, then removes its records. It also sends SIP traffic; use a local test stack.

## SIP Explorer / Traffic Search

Open **SIP Explorer** to search individual SIP security events. **Events** still groups sessions by Call-ID and opens the existing signaling viewer. Explorer stores/searches metadata, not full SIP payloads, SDP, RTP, recordings, or call-quality measurements; this is SIP security search, not full VoIPMonitor monitoring. Existing signaling captures remain separately sanitized (credentials redacted and bodies omitted).

Search answers who sent traffic, the claimed caller and destination number/domain, the selected backend, observed response, and gateway decision/reason. Source IP/port/transport are socket-observed; caller ID and SIP URI/header identities are sender claims, not authenticated identities. Called number is the Request-URI user; caller ID is the From user. Backend host/port describe the selected next hop. Request decisions and backend response observations are separate events, including provisional/retransmitted responses; summary cards count events, not unique calls. **Allowed** means the gateway permitted forwarding, even when the backend returns 401/403/404. Local denials carry their response code. Missing historical metadata stays unknown. ASN/name/country are nullable fields accepted from trusted structured collector records; automatic GeoIP/ASN enrichment is not installed and no external enrichment requests occur in the SIP path.

Filters: time range, customer, exact source IP, called number, caller ID, backend host, method, response code, action (`allowed`, `blocked`, `would_block`), User-Agent substring, ASN, two-letter country code, and Call-ID. User-Agent matching is literal and case-insensitive; other text filters are exact. The default range is the last 24 hours; each search is bounded to 31 days. Dates sent to the API must include a timezone; the dashboard displays local times. Source/number/backend/response/method/action/customer/time/Call-ID indexes support operational searches. Queries use a read-only snapshot and a five-second timeout per statement; narrow filters if a large summary times out. Deep offsets are capped at 100,000; narrow the time window instead. This is not a full-text or arbitrary domain search.

`GET /api/sip-events/search` requires the same administrator session as the rest of the dashboard. It accepts `date_from`, `date_to`, `customer_id`, `source_ip`, `called_number`, `caller_id`, `backend_host`, `method`, `response_code`, `action`, `user_agent`, `asn`, `country`, `call_id`, `limit` (1–1,000, default 100), and `offset` (default 0). It returns `events`, filtered `summary`, and effective pagination/time range. Date bounds are inclusive start/exclusive end. For example:

```text
/api/sip-events/search?method=REGISTER&response_code=401&limit=100&offset=0
```

Click **View details** for all available metadata. **Export page CSV** exports the current applied filters/page, not an unbounded download. API clients can use the same endpoint with `format=csv`. Potential spreadsheet formulas are prefixed with an apostrophe, including phone numbers starting with `+`. Management API/DB/Redis downtime never enters the SIP request path: Kamailio keeps cached routing/security rules and journals events locally; the collector catches up after PostgreSQL recovers. Logs and PostgreSQL events currently have no automated retention; schedule cleanup before sustained production use.

Upgrade a published-image stack with `docker compose pull` then `docker compose up -d`; for local sources use `docker compose -f docker-compose.dev.yml up --build -d`. The API applies additive schema changes to the existing database; no database reset is needed. This release changes native event logging, so Kamailio must be recreated once during upgrade. Common dashboard rule updates continue using runtime table reloads without restarting SIP. Inspect collection with `docker compose logs -f collector` and `docker compose logs -f kamailio`.

Explorer checks: `cd api && npm test`, `node scripts/sip-explorer-smoke.mjs` from the project root (requires UDP port 5076).

## Runtime boundaries

Explorer's empty **To** field means “now” on each search/refresh; set it for a fixed historical end time. Response metadata comes from observed backend replies and explicit local policy replies. TM-generated timeouts/relay errors are not separately journaled to `sip_events` yet, so an unknown response does not imply call success.

Production-lite, not a complete SBC: no RTPengine in this phase, SIP TLS deployment, HA, registrar/authentication of SIP users, topology hiding, media/NAT relay, rate-limit HA, multi-backend health failover or production audit/retention policy. Single runtime updater and collector are supported. Table-generation switch and selector persistence are not a distributed transaction: a worker crash/database loss between RPC activation and persisted confirmation can briefly show an unknown/stale status. Startup/retry reconciliation restores persisted selectors. Common changes do not restart Kamailio; editing the native template/modules still requires a planned process/container restart. Back up PostgreSQL and monitor reload failures, queue growth, event lag and disk usage.

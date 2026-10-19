<p align="center">
  <img src="docs/assets/memora-logo.png" alt="Memora" width="96" height="96">
</p>

<h1 align="center">Memora</h1>

<p align="center"><b>Second brain for your AI.</b><br>Long-term memory for AI agents, on your own server.</p>

<p align="center">
  <a href="https://github.com/Codrihub/memora/releases/latest"><img src="https://img.shields.io/github/v/release/Codrihub/memora?sort=semver" alt="Latest release"></a>
  <a href="https://github.com/Codrihub/memora/actions/workflows/ci.yml"><img src="https://github.com/Codrihub/memora/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Codrihub/memora" alt="License: MIT"></a>
  <a href="https://github.com/Codrihub/memora/pkgs/container/memora"><img src="https://img.shields.io/badge/ghcr.io-codrihub%2Fmemora-blue?logo=docker" alt="Docker image"></a>
</p>

<p align="center">
  <a href="https://memora.codrihub.tech">Website</a> ·
  <a href="https://memora.codrihub.tech/docs">Documentation</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="https://github.com/Codrihub/memora/releases">Releases</a>
</p>

Memora is a self-hosted memory vault for AI agents. Notes are plain markdown
files in a git-backed folder. Agents read and write them over the Model Context
Protocol (MCP); you browse, edit and govern them in a web UI. One Rust binary
serves the HTTP API, the MCP endpoint, the web UI and realtime updates on a
single port, with all server state in one embedded SQLite database.

## Screenshots

![Overview](docs/screenshots/overview.jpg)

| | |
|---|---|
| ![Brain](docs/screenshots/brain.jpg) **Brain**: every folder is a region, every note a node | ![Node card](docs/screenshots/brain-node.jpg) **Node card**: links, backlinks and a preview |
| ![Graph](docs/screenshots/graph.jpg) **Graph**: force, radial or cluster layouts | ![Canvas](docs/screenshots/canvas.jpg) **Canvas**: one frame per folder |
| ![Reader](docs/screenshots/reader.jpg) **Reader** with contents and reading settings | ![Activity](docs/screenshots/activity.jpg) **Activity**: every agent call, live |
| ![Agents](docs/screenshots/agents.jpg) **Agents & API keys**: one key per agent, scoped | |

Screenshots use a demo vault.

## Features

- **Markdown you own.** Every note is a `.md` file with optional frontmatter and
  `[[wikilinks]]`. Edit it with any tool; nothing is locked in a database.
- **Git history.** Changes are committed, so any revision can be listed, diffed
  and restored (`get_history`, `diff`, `restore_memory`).
- **MCP for agents.** 71 tools for notes, folders, search, tags, graph traversal,
  history, locks, activity and import/export, plus admin tools, over the
  streamable HTTP transport.
- **API keys or OAuth.** Give each agent its own key, or let MCP clients such as
  Claude or ChatGPT connect with OAuth after you approve them in the browser.
- **Per-agent control.** Scopes (`mcp`, `read`, `write`, `admin`), per-key tool
  lists, server-wide tool switches, and privacy rules that hide notes or
  folders from chosen agents.
- **Web UI.** Brain and graph views, a canvas, the vault editor, tags, live
  agent activity, keys, tools, access rules and settings. Installable as a PWA.
- **Safe first run.** An unclaimed instance cannot be taken over by whoever
  finds the port: the operator console opens a short setup window and you
  finish in the browser.
- **One port, one process.** HTTP API, MCP, UI and WebSocket share port 8400.
  The database has no network port.

## Quick start

Three steps, about two minutes.

**1. Install** (pick one)

```bash
# Linux server with systemd (x86_64 or aarch64)
curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh | sudo sh

# or anywhere with Docker
docker run -d --name memora --restart unless-stopped -p 8400:8400 \
  -v memora-data:/data -v memora-state:/state ghcr.io/codrihub/memora:latest
```

**2. Get a one-time setup code**

```bash
sudo memora-cli setup --minutes 15                    # native
docker exec -it memora memora-cli setup --minutes 15  # Docker
```

**3. Open the link it prints** (`http://<your-server>:8400/login`), enter the code
and create your account. Memora then asks which folder to use as the vault and
shows how to connect your first agent.

That is all. The sections below cover every other option.

### Docker Compose

```bash
git clone https://github.com/Codrihub/memora.git && cd memora
cp .env.example .env                     # optional, every value has a default
mkdir -p data state && sudo chown -R 1000:1000 data state
docker compose up -d
docker compose exec -it gateway memora-cli   # then type /web
```

The image is `ghcr.io/codrihub/memora` (linux/amd64 and linux/arm64). See
[docker/README.md](docker/README.md) for volumes, upgrades and local builds.

### Native installer (Linux x86_64 / aarch64 with systemd)

One command:

```bash
curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh | sudo sh
```

Or download it and read it first:

```bash
curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh -o install.sh
less install.sh                          # read it first
sudo sh install.sh                       # add --behind-proxy for a local reverse proxy
sudo memora-cli                          # then type /web
```

The installer downloads the release for your CPU, verifies it against the
release `SHA256SUMS`, creates a `memora` system user, and installs a hardened
`memora.service` unit. Data lives in `/var/lib/memora`. Run
`sh install.sh --help` for every option, and see
[docs/INSTALL.md](docs/INSTALL.md) for details.

### npm (Linux x86_64 / arm64)

```bash
npm install -g @codrihub/memora
mkdir -p ~/memora && cd ~/memora
MEMORA_VAULT=./vault MEMORA_STATE=./state memora
# in a second terminal, same folder:
MEMORA_STATE=./state memora-cli          # then type /web
```

The package carries the prebuilt release binaries and the web UI (no install
script, nothing downloaded at install time) and needs Node 18 or newer. It is
handy for trying Memora or running it under your own user; for a server, the
native installer adds the systemd service. On macOS and Windows use Docker or
build from source. Update with `npm install -g @codrihub/memora@latest`.

### From source

```bash
git clone https://github.com/Codrihub/memora.git && cd memora
cargo build --release
MEMORA_VAULT=./data MEMORA_STATE=./state ./target/release/memora
# in a second terminal:
./target/release/memora-cli              # then type /web
```

The server binds to `127.0.0.1:8400` by default. To install your build as a
service: `sudo ./scripts/install.sh --from-source`. The web UI is built from
`web/` (see [CONTRIBUTING.md](CONTRIBUTING.md)).

### First run

1. In the console, type `/web`. It prints a one-time setup code.
2. Open `http://<host>:8400/login`, enter the code and create the owner account.
3. Choose the vault folder (`/var/lib/memora/vault` natively, `/data` in Docker).
4. Create an API key for an agent (web UI or `/keys` in the console) and
   connect it over MCP (`/mcp` in the console prints a ready-made config).

If a setup window expires unused, the instance locks until you run
`memora-cli setup` or `memora-cli unlock` on the server.

## Configuration

Settings come from the environment (systemd unit, `.env` for Docker) and can be
overridden in the state database with `memora-cli` -> `/config`; a stored value
wins until you clear it. The most common ones:

| Name | Default | Meaning |
|---|---|---|
| `MEMORA_PORT` | `8400` | HTTP port for API, MCP, UI and WebSocket |
| `MEMORA_BIND` | `127.0.0.1` | Bind address (`0.0.0.0` in the container) |
| `MEMORA_STATE` | `state` | Directory holding `memora.db` |
| `MEMORA_VAULT` | empty | Suggested vault folder; the vault is confirmed in the browser |
| `MEMORA_BASE_URL` | empty | Public URL behind a reverse proxy |
| `MEMORA_DOMAIN` | empty (any) | Allowed hostnames; other hosts get 404 |
| `MEMORA_TRUSTED_PROXIES` | empty | Remote proxies whose forwarding headers are trusted |
| `MEMORA_ADMIN_PASSWORD[_FILE]`, `MEMORA_API_KEY[_FILE]` | unset | Provision an owner or an agent key at startup; only hashes are stored |
| `RUST_LOG` | `info` | Log filter |

The full list, precedence rules and the Docker Compose variables are in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md). For TLS, reverse proxies and
hardening, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Connecting agents over MCP

The MCP endpoint is `/mcp` on the same port. Authenticate with an API key in
`Authorization: Bearer <key>` (or `X-API-Key`), or let the client use OAuth.

Claude Code:

```bash
claude mcp add --transport http memora https://memory.example.com/mcp \
  --header "Authorization: Bearer memora_live_REPLACE_WITH_YOUR_KEY"
```

Clients with an `mcpServers` JSON config:

```json
{
  "mcpServers": {
    "memora": {
      "type": "http",
      "url": "http://localhost:8400/mcp",
      "headers": {
        "Authorization": "Bearer memora_live_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
```

Clients that support MCP authorization can connect with only the URL; you
approve them in the browser and they appear as keys you can restrict or revoke.
The discovery card is at `/.well-known/mcp.json` and a readable tool catalog at
`/tools`. [docs/MCP.md](docs/MCP.md) covers OAuth, other clients, every tool and
the error codes; [docs/API.md](docs/API.md) lists the HTTP API.

## Operating

```bash
sudo systemctl status memora             # native service
sudo journalctl -u memora -f             # logs
sudo memora-cli                          # console: /status, /keys, /tools, /config, /backup ...
sudo memora-cli db backup                # consistent copy of memora.db, safe while running
sudo /usr/local/share/memora/install.sh --upgrade
docker compose pull && docker compose up -d   # Docker upgrade
```

Back up the vault folder and `memora.db` (with `memora-cli db backup`, never a
plain `cp` of the live file). See [docs/INSTALL.md](docs/INSTALL.md#backups).

## Security notes

- The owner password is hashed with argon2id. API keys (`memora_live_...`) and
  session ids are stored only as SHA-256 hashes; a key is shown once.
- Session cookies are `HttpOnly` and `SameSite=Lax`, cookie writes are checked
  against the request origin, and pages use a nonce-based Content-Security-Policy.
- Login and setup are rate limited with cooldowns; a wrong setup code closes the
  window.
- Forwarding headers are trusted only from loopback and `MEMORA_TRUSTED_PROXIES`.
- Access rules can allow or block by IP, range, CIDR and domain; loopback always
  stays allowed so you cannot lock yourself out.
- Terminate TLS at a reverse proxy before exposing Memora to the internet.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | Native installer, Docker, npm, reverse proxy, backups |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every setting and where it lives |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment and hardening |
| [docs/MCP.md](docs/MCP.md) | Connecting agents, OAuth, tool reference |
| [docs/API.md](docs/API.md) | HTTP API |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Crates, request flow, vault files |
| [docs/DATABASE.md](docs/DATABASE.md) | State database schema |

## Project layout

```
crates/core      vault: markdown, wikilinks, search, graph, git history
crates/state     SQLite state database (memora.db)
crates/gateway   password and key hashing, access checks, environment provisioning
crates/mcp       MCP server: tool catalog, permissions, privacy
crates/http      axum server: middleware, API, OAuth, UI assets (binary: memora)
crates/cli       operator console (binary: memora-cli)
web/             web UI (TypeScript), built into crates/http/assets
docker/          container entrypoint and release Dockerfile
docs/            user and operator documentation
scripts/         installer and maintenance scripts
```

## Versioning

Memora follows [Semantic Versioning](https://semver.org/). Each release is a
`vX.Y.Z` tag with a [GitHub Release](https://github.com/Codrihub/memora/releases)
(static Linux binaries for x86_64 and aarch64 plus `SHA256SUMS`) and a
multi-arch image `ghcr.io/codrihub/memora:X.Y.Z`. Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request.

## License

MIT, see [LICENSE](LICENSE). Memora by Codrihub Tech.

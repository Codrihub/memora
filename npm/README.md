# @codrihub/memora

[Memora](https://github.com/Codrihub/memora) is a self-hosted memory vault for
AI agents: a folder of Markdown notes that agents read and write over MCP, with
a web UI to browse, edit and govern it. One process serves the web UI, the HTTP
API, MCP and realtime updates on a single port.

This package installs the prebuilt release binaries:

| Command | Role |
|---|---|
| `memora` | The server (default `127.0.0.1:8400`) |
| `memora-cli` | The operator console: setup codes, keys, backups, config |

## Install

```sh
npm install -g @codrihub/memora
```

or run it without installing:

```sh
npx @codrihub/memora --version
```

Supported: Linux on x86_64 and arm64 (static binaries, glibc or musl), Node 18
or newer. npm picks the matching `@codrihub/memora-linux-*` package; nothing is
downloaded by an install script, so it works offline from a registry mirror and
with `--ignore-scripts`. On macOS and Windows use
[Docker](https://github.com/Codrihub/memora#docker-compose) or
[build from source](https://github.com/Codrihub/memora#from-source); on Windows
WSL 2 works too.

## Run

```sh
mkdir -p ~/memora && cd ~/memora
MEMORA_VAULT=./vault MEMORA_STATE=./state memora
# in a second terminal, same folder:
MEMORA_STATE=./state memora-cli          # then type /web
```

`/web` prints a one-time setup code. Open `http://127.0.0.1:8400/login`, enter
it, create the owner account, then connect an agent over MCP (`/mcp` in the
console prints a ready-made config).

The web UI ships in this package and is used unless `MEMORA_ASSETS` points
elsewhere. Every other setting is an environment variable or
`memora-cli config`; see
[Configuration](https://github.com/Codrihub/memora/blob/main/docs/CONFIGURATION.md).

For a long-running server, the
[native installer](https://github.com/Codrihub/memora#native-installer-linux-x86_64--aarch64-with-systemd)
sets up a hardened systemd service instead.

## Update

```sh
npm install -g @codrihub/memora@latest
```

The state database is migrated on the next start.

## License

MIT

# syntax=docker/dockerfile:1
#
# Memora container image, built from source.
#
# One image ships two binaries:
#   memora      the server: HTTP API, MCP, web UI and WebSocket on port 8400
#   memora-cli  the operator console (setup codes, keys, backups)
#
# The role is chosen by the container command:
#   serve | gateway | all   -> memora (the only published port)
#   setup                   -> memora-cli setup
#   reset-password          -> memora-cli reset-password
#   status                  -> memora-cli status
#   unlock                  -> memora-cli unlock
#   list                    -> memora-cli list
#   cli <args>              -> memora-cli <args>
#
# Build:
#   docker build -t memora:local .
#
# Multi-arch:
#   docker buildx build --platform linux/amd64,linux/arm64 -t memora:local .
#
# The release workflow uses docker/Dockerfile.release instead, which packages
# the static binaries CI already built.

# ---------------------------------------------------------------- build stage
# Pinned toolchain for reproducible image builds.
FROM rust:1.99-slim-bookworm AS builder

ENV CARGO_TERM_COLOR=never \
    CARGO_NET_RETRY=5

# rusqlite is compiled with its "bundled" feature, which needs a C toolchain.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache the dependency graph before the sources: manifests first, sources later.
COPY Cargo.toml Cargo.lock ./
COPY crates/core/Cargo.toml    crates/core/Cargo.toml
COPY crates/mcp/Cargo.toml     crates/mcp/Cargo.toml
COPY crates/gateway/Cargo.toml crates/gateway/Cargo.toml
COPY crates/http/Cargo.toml    crates/http/Cargo.toml
COPY crates/cli/Cargo.toml     crates/cli/Cargo.toml
COPY crates/state/Cargo.toml   crates/state/Cargo.toml
# Stub sources so "cargo fetch" can run before the real sources are copied.
RUN for c in core mcp gateway http cli state; do mkdir -p crates/$c/src; \
      printf 'fn main(){}\n' > crates/$c/src/main.rs; \
      printf '' > crates/$c/src/lib.rs; \
    done
RUN cargo fetch --locked

COPY crates ./crates
# Touch the sources so cargo does not reuse artifacts built from the stubs.
# The release profile already strips the binaries.
RUN find crates -name '*.rs' -exec touch {} + \
 && cargo build --release --locked

# -------------------------------------------------------------- runtime stage
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1000 memora \
 && useradd -u 1000 -g 1000 -m -d /home/memora -s /usr/sbin/nologin memora

WORKDIR /app

COPY --from=builder /build/target/release/memora     /usr/local/bin/memora
COPY --from=builder /build/target/release/memora-cli /usr/local/bin/memora-cli
COPY crates/http/assets /app/assets
COPY docker/entrypoint.sh    /usr/local/bin/entrypoint.sh
COPY docker/setup-wrapper.sh /usr/local/bin/setup

RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/setup \
 && mkdir -p /data /state \
 && chown -R memora:memora /app /data /state

# Vault and state are mounted as volumes; 8400 is the only published port.
ENV MEMORA_VAULT=/data \
    MEMORA_STATE=/state \
    MEMORA_PORT=8400 \
    MEMORA_BIND=0.0.0.0 \
    MEMORA_ARM_TTL=300 \
    MEMORA_ASSETS=/app/assets \
    MEMORA_INSTALL=docker \
    GIT_AUTHOR_NAME=Memora \
    GIT_AUTHOR_EMAIL=memora@localhost \
    GIT_COMMITTER_NAME=Memora \
    GIT_COMMITTER_EMAIL=memora@localhost \
    RUST_LOG=info

EXPOSE 8400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${MEMORA_PORT}/healthz" || exit 1

USER memora

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["serve"]

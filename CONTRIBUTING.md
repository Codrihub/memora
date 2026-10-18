# Contributing to Memora

Thanks for your interest in improving Memora. This document covers the workflow.

## Getting started

You need a recent stable Rust toolchain, and Node.js 22 or newer if you change
the web UI. Build and test with Cargo:

```bash
cargo build --release
scripts/test.sh            # cargo test --workspace with a throwaway TMPDIR
```

Run the server locally, then open the console in a second terminal and type
`/web` for a one-time setup code:

```bash
MEMORA_VAULT=./data MEMORA_STATE=./state ./target/release/memora
./target/release/memora-cli
```

## Web UI

The browser app is TypeScript in `web/src`. Building it writes the bundle to
`crates/http/assets`, which the server serves:

```bash
cd web
npm ci
npm run typecheck
npm run build
```

Styles live in TypeScript modules and `web/src/*.css`; please do not add
hand-written HTML or JavaScript files.

## Development workflow

1. Fork the repository and create a branch from the default branch.
2. Make your change. Keep it focused; small pull requests are easier to review.
3. Make sure the checks below pass.
4. Open a pull request and fill in the template.

## Checks

Run these before pushing. CI runs the same commands.

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo build --workspace --release
cargo test --workspace
```

## Code style

- Follow `rustfmt`. The `fmt` check is authoritative.
- Clippy runs with `-D warnings`; do not add new lints.
- Keep comments and documentation in clear English.
- Prefer small, named functions over long ones.
- Do not introduce panics on user input. Return errors instead.

## Documentation and prose

Documentation is part of the product. When you change behavior, update the
relevant file under `docs/`:

- `ARCHITECTURE.md` for structure and data flow.
- `CONFIGURATION.md` for environment variables and state files.
- `DATABASE.md` for the state database schema.
- `MCP.md` for the tool catalog and agent usage.
- `API.md` for HTTP endpoints.
- `INSTALL.md` and `DEPLOYMENT.md` for installing and running it in production.

Keep the existing tone: professional English, concise, no em dashes. Write in
plain sentences. Prefer periods, commas, colons, and parentheses.

## Commits

Write commit messages in the imperative mood with a short summary line, for
example `add restore_trash tool` or `fix session cookie on HTTPS`. Add a body
when the reason is not obvious.

## Reporting bugs and requesting features

Use the issue templates. For bugs, include the version, your deployment method
(binary or container), and steps to reproduce. For security issues, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing, you agree that your contributions are licensed under the MIT
License, as described in [LICENSE](LICENSE).

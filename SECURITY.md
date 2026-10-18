# Security Policy

## Supported versions

Security fixes are applied to the latest release. Run the newest published
version to receive them.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately:

- Use GitHub's private vulnerability reporting on the repository
  (Security tab, "Report a vulnerability"), or
- Email the maintainers at the address listed in the repository profile.

Include as much as you can:

- A description of the issue and its impact.
- Steps to reproduce, or a proof of concept.
- Affected version and deployment method (binary or container).
- Any suggested fix or mitigation.

We aim to acknowledge reports within a few business days and to provide a
timeline for a fix. We will credit reporters who wish to be named once a fix is
released.

## Security model

Memora is designed to run as a single-owner service, usually behind a reverse
proxy. Relevant properties:

- User passwords are stored as argon2id hashes and verified in constant time.
- API keys are random, shown once, and stored only as SHA-256 hex. Verification
  is constant time. Unknown hash formats are rejected.
- Browser sessions use an `HttpOnly`, `SameSite=Lax` cookie with a sliding TTL.
  Only a hash of the session id is stored. The `Secure` attribute is set when
  the request arrives over HTTPS through a trusted proxy.
- Cookie-based writes are protected by an origin check (`Origin`/`Referer`
  against `Host`). Pages are served with a nonce-based Content-Security-Policy.
- API keys carry scopes (`mcp`, `read`, `write`, `admin`) and an optional tool
  list; tools can be switched off for every key, and privacy rules hide notes or
  folders from chosen agents.
- MCP clients that use OAuth get an ordinary API key after the owner approves
  them in the browser (authorization code with PKCE S256), so the same scopes,
  revocation and activity log apply.
- An unclaimed instance is protected by the setup window: the CLI opens a
  short-lived session and the browser completes it. If the window expires
  unfinished, the instance locks and only recovery paths stay reachable.
- The access stack can restrict access by IP, range, CIDR, and domain, with
  loopback always allowed to prevent lockout.
- The local event intake (`POST /_bus`) accepts loopback only.

## Deployment guidance

- Terminate TLS at the reverse proxy and forward `X-Forwarded-Proto: https`.
- Keep the state directory private. Its database, `memora.db`, holds credential
  hashes and the activity log.
- Back up `memora.db` with `memora-cli db backup`; losing it loses the owner
  account, API keys and settings.
- Do not expose the service directly on a public interface without a proxy and
  without the access stack configured.
- Rotate API keys periodically (web UI, `memora-cli` -> `/keys`, or
  `POST /api/keys/roll`).

## Out of scope

- Misconfiguration of a reverse proxy or TLS termination.
- Issues that require an already-compromised host or root access.
- Denial of service from an attacker with unlimited network access, absent a
  specific, novel amplification vector.

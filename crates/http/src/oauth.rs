//! OAuth 2.1 authorization server for remote MCP clients (Claude, ChatGPT, ...).
//!
//! * Discovery: `/.well-known/oauth-protected-resource` (RFC 9728) and
//!   `/.well-known/oauth-authorization-server` (RFC 8414); `/mcp` answers 401
//!   with a `WWW-Authenticate` header pointing at the former.
//! * Clients: dynamic registration (RFC 7591, `/oauth/register`), a client
//!   metadata document URL as `client_id` (CIMD, fetched over HTTPS), or one the
//!   owner registers in the dashboard.
//! * Flow: authorization code + PKCE S256 only. `/oauth/authorize` sends the
//!   browser to the sign-in page, which shows a consent card; the signed-in owner
//!   approves through `/api/oauth/approve`. `/oauth/token` swaps the code for an
//!   access token, which is a fresh API key (so permissions, colors, activity and
//!   revocation work as for any agent), plus a rotating refresh token.

use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use memora_state::oauth::{self as store, Client};
use serde_json::{json, Value};
use std::io::Read;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use crate::api::{act_tx, bad, body_str, csrf_fail, csrf_ok, db_err};
use crate::cache;
use crate::AppState;

/// Authorization codes live this long (seconds).
const CODE_TTL: i64 = 600;
/// A fetched client metadata document is trusted this long (seconds).
const CIMD_TTL: i64 = 86_400;
/// Largest client metadata document accepted.
const CIMD_MAX_BYTES: u64 = 64 * 1024;

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/// `https://host` as the client sees it. Proxies signal the scheme in different
/// ways (`X-Forwarded-Proto`, `Forwarded`, Cloudflare's `CF-Visitor`); without
/// any, a plain domain name (no port, not an IP or localhost) is taken as HTTPS,
/// since public MCP endpoints are always served over TLS.
pub(crate) fn base_url(headers: &HeaderMap) -> String {
    // A configured public URL is the server's identity, whatever the request says.
    if let Some(b) = configured_base() {
        return b.to_string();
    }
    guess_base(headers)
}

/// `MEMORA_BASE_URL` (env or `memora-cli /config`, read at start), when it is an
/// http(s) URL: the issuer, resource and endpoints OAuth clients see.
pub(crate) fn configured_base() -> Option<&'static str> {
    static BASE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    BASE.get_or_init(|| {
        std::env::var("MEMORA_BASE_URL")
            .ok()
            .map(|v| v.trim().trim_end_matches('/').to_string())
            .filter(|v| (v.starts_with("https://") || v.starts_with("http://")) && v.len() > 8)
    })
    .as_deref()
}

/// The public URL guessed from the request (no `MEMORA_BASE_URL` set).
fn guess_base(headers: &HeaderMap) -> String {
    let h = |k: &str| {
        headers
            .get(k)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
    };
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost")
        .trim()
        .to_string();
    let xfp = h("x-forwarded-proto");
    let fwd = h("forwarded");
    let proto = if let Some(p) = xfp
        .split(',')
        .next()
        .map(str::trim)
        .filter(|p| *p == "https" || *p == "http")
    {
        p.to_string()
    } else if let Some(p) = fwd
        .split([';', ','])
        .find_map(|kv| kv.trim().strip_prefix("proto="))
        .map(|p| p.trim_matches('"').to_string())
        .filter(|p| p == "https" || p == "http")
    {
        p
    } else if h("cf-visitor").contains("\"https\"") || h("x-forwarded-ssl") == "on" {
        "https".into()
    } else {
        let name = host.rsplit_once(':').map_or(host.as_str(), |(n, _)| n);
        let plain_domain = !host.contains(':')
            && name.contains('.')
            && name.parse::<std::net::IpAddr>().is_err()
            && !name.ends_with(".local")
            && name != "localhost";
        if plain_domain {
            "https".into()
        } else {
            "http".into()
        }
    };
    format!("{proto}://{host}")
}

/// `WWW-Authenticate` for an unauthenticated `/mcp` request: where to find the
/// authorization server (MCP authorization spec).
pub(crate) fn mcp_challenge(headers: &HeaderMap) -> HeaderValue {
    let v = format!(
        "Bearer resource_metadata=\"{}/.well-known/oauth-protected-resource\"",
        base_url(headers)
    );
    HeaderValue::from_str(&v).unwrap_or_else(|_| HeaderValue::from_static("Bearer"))
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `a=b&c=d` (query or form body) into pairs.
fn pairs(q: &str) -> Vec<(String, String)> {
    q.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| match p.split_once('=') {
            Some((k, v)) => (crate::percent_decode(k), crate::percent_decode(v)),
            None => (crate::percent_decode(p), String::new()),
        })
        .collect()
}

fn param<'a>(p: &'a [(String, String)], k: &str) -> &'a str {
    p.iter()
        .find(|(x, _)| x == k)
        .map(|(_, v)| v.as_str())
        .unwrap_or("")
}

/// `uri` with `params` appended to its query.
fn with_query(uri: &str, params: &[(&str, &str)]) -> String {
    let q: Vec<String> = params
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k}={}", encode(v)))
        .collect();
    let sep = if uri.contains('?') { '&' } else { '?' };
    format!("{uri}{sep}{}", q.join("&"))
}

/// A redirect URI a client may register: HTTPS anywhere, or plain HTTP on the
/// loopback interface (desktop and CLI clients); no fragment, no userinfo
/// (`http://localhost:1@evil.example/` must not pass as loopback, and the
/// consent card must show the real host).
fn valid_redirect(u: &str) -> bool {
    if u.len() > 2000 || u.contains('#') || u.chars().any(char::is_whitespace) {
        return false;
    }
    let (https, rest) = match (u.strip_prefix("https://"), u.strip_prefix("http://")) {
        (Some(r), _) => (true, r),
        (None, Some(r)) => (false, r),
        (None, None) => return false,
    };
    let host = rest.split(['/', '?']).next().unwrap_or("");
    if host.is_empty() || host.contains('@') {
        return false;
    }
    if https {
        return true;
    }
    let name = host.rsplit_once(':').map_or(host, |(h, _)| h);
    matches!(name, "localhost" | "127.0.0.1" | "[::1]")
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async fn h_protected_resource(headers: HeaderMap) -> Response {
    let base = base_url(&headers);
    Json(json!({
        "resource": format!("{base}/mcp"),
        "authorization_servers": [base],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["mcp"],
        "resource_name": "Memora",
    }))
    .into_response()
}

async fn h_authorization_server(headers: HeaderMap) -> Response {
    let base = base_url(&headers);
    Json(json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/oauth/authorize"),
        "token_endpoint": format!("{base}/oauth/token"),
        "registration_endpoint": format!("{base}/oauth/register"),
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        // Every client is public (PKCE); none is issued a secret.
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["mcp"],
        "client_id_metadata_document_supported": true,
        "authorization_response_iss_parameter_supported": true,
        "service_documentation": format!("{base}/agents"),
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

fn uris_of(v: &Value) -> Result<Vec<String>, String> {
    let list: Vec<String> = v
        .get("redirect_uris")
        .and_then(|x| x.as_array())
        .ok_or("redirect_uris is required")?
        .iter()
        .filter_map(|x| x.as_str().map(str::to_string))
        .collect();
    if list.is_empty() || list.len() > 10 {
        return Err("redirect_uris needs 1-10 URIs".into());
    }
    if let Some(bad) = list.iter().find(|u| !valid_redirect(u)) {
        return Err(format!("redirect URI not allowed: {bad}"));
    }
    Ok(list)
}

fn oauth_error(code: StatusCode, error: &str, desc: &str) -> Response {
    let mut r = (
        code,
        Json(json!({"error": error, "error_description": desc})),
    )
        .into_response();
    r.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

/// `POST /oauth/register` (RFC 7591): register a public client.
async fn h_register(State(st): State<AppState>, Json(b): Json<Value>) -> Response {
    let uris = match uris_of(&b) {
        Ok(u) => u,
        Err(e) => return oauth_error(StatusCode::BAD_REQUEST, "invalid_redirect_uri", &e),
    };
    let name = b
        .get("client_name")
        .and_then(|x| x.as_str())
        .unwrap_or("MCP client")
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    let now = memora_state::now();
    let full = st
        .db
        .write(|tx| {
            if store::count_clients(tx)? >= store::MAX_CLIENTS {
                store::prune(tx, now)?;
            }
            Ok(store::count_clients(tx)? >= store::MAX_CLIENTS)
        })
        .unwrap_or(true);
    if full {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_client_metadata",
            "too many registered clients",
        );
    }
    let client = Client {
        client_id: memora_gateway::random_token("mcpc")[..37].to_string(),
        name: if name.is_empty() {
            "MCP client".into()
        } else {
            name
        },
        redirect_uris: uris,
        kind: "dcr".into(),
        created_at: now,
        fetched_at: None,
    };
    if let Err(e) = st.db.write(|tx| store::put_client(tx, &client)) {
        return db_err(e, "client");
    }
    (
        StatusCode::CREATED,
        Json(json!({
            "client_id": client.client_id,
            "client_name": client.name,
            "redirect_uris": client.redirect_uris,
            "client_id_issued_at": now,
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        })),
    )
        .into_response()
}

/// Whether an address is safe to fetch from (public unicast only).
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || v.is_multicast()
                // 0.0.0.0/8 ("this network"), 100.64.0.0/10 (CGNAT), 240.0.0.0/4 (reserved)
                || o[0] == 0
                || o[0] == 100 && (64..128).contains(&o[1])
                || o[0] >= 240
                // 192.0.0.0/24 (protocol assignments), 198.18.0.0/15 (benchmarking),
                // and the documentation ranges.
                || o[..3] == [192, 0, 0]
                || o[0] == 198 && (o[1] == 18 || o[1] == 19)
                || o[..3] == [192, 0, 2]
                || o[..3] == [198, 51, 100]
                || o[..3] == [203, 0, 113])
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            let seg = s[0];
            // An IPv4 address carried inside IPv6 (NAT64, 6to4, IPv4-compatible)
            // must itself be public: a gateway would deliver it to that address.
            let embedded = if s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] || s[..6] == [0; 6] {
                Some(std::net::Ipv4Addr::new(
                    (s[6] >> 8) as u8,
                    s[6] as u8,
                    (s[7] >> 8) as u8,
                    s[7] as u8,
                ))
            } else if seg == 0x2002 {
                Some(std::net::Ipv4Addr::new(
                    (s[1] >> 8) as u8,
                    s[1] as u8,
                    (s[2] >> 8) as u8,
                    s[2] as u8,
                ))
            } else {
                None
            };
            !(v.is_loopback()
                || v.is_unspecified()
                || v.is_multicast()
                || seg & 0xfe00 == 0xfc00
                || seg & 0xffc0 == 0xfe80
                // fec0::/10 (old site-local), 64:ff9b:1::/48 (local NAT64),
                // 2001::/32 (Teredo), 2001:db8::/32 (documentation), 100::/64 (discard).
                || seg & 0xffc0 == 0xfec0
                || s[..3] == [0x64, 0xff9b, 1]
                || s[..2] == [0x2001, 0]
                || s[..2] == [0x2001, 0xdb8]
                || s[..4] == [0x100, 0, 0, 0])
                && v.to_ipv4_mapped().is_none_or(|m| public_ip(IpAddr::V4(m)))
                && embedded.is_none_or(|m| public_ip(IpAddr::V4(m)))
        }
    }
}

/// Fetch and check a client metadata document (CIMD): HTTPS on a public address,
/// no redirects, small, and naming itself as `client_id`.
fn fetch_cimd(url: &str, now: i64) -> Result<Client, String> {
    let rest = url
        .strip_prefix("https://")
        .ok_or("client_id URL must be https")?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.contains('@') || url.len() > 512 || !rest.contains('/') {
        return Err("invalid client_id URL".into());
    }
    let (name, port) = match host.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| "invalid port")?),
        None => (host, 443),
    };
    // One answer for "does not resolve" and "resolves to a private address":
    // this is reachable without signing in, and two answers would let anyone
    // probe which internal host names exist.
    let not_public = || "client_id host does not resolve to a public address".to_string();
    let addrs: Vec<SocketAddr> = (name, port)
        .to_socket_addrs()
        .map_err(|_| not_public())?
        .collect();
    if addrs.is_empty() || !addrs.iter().all(|a| public_ip(a.ip())) {
        return Err(not_public());
    }
    let agent = ureq::AgentBuilder::new()
        // Connect only to the addresses checked above: a second lookup could
        // answer with a private address (DNS rebinding).
        .resolver(move |_: &str| Ok(addrs.clone()))
        .timeout(Duration::from_secs(6))
        .redirects(0)
        .user_agent(concat!(
            "Memora/",
            env!("CARGO_PKG_VERSION"),
            " (OAuth client metadata)"
        ))
        .build();
    let resp = agent
        .get(url)
        .set("Accept", "application/json")
        .call()
        .map_err(|e| format!("cannot fetch client metadata: {e}"))?;
    let mut raw = String::new();
    resp.into_reader()
        .take(CIMD_MAX_BYTES)
        .read_to_string(&mut raw)
        .map_err(|e| format!("cannot read client metadata: {e}"))?;
    let doc: Value = serde_json::from_str(&raw).map_err(|_| "client metadata is not JSON")?;
    if doc.get("client_id").and_then(|v| v.as_str()) != Some(url) {
        return Err("client metadata client_id does not match its URL".into());
    }
    let uris = uris_of(&doc)?;
    let name = doc
        .get("client_name")
        .and_then(|v| v.as_str())
        .unwrap_or(name)
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    Ok(Client {
        client_id: url.to_string(),
        name,
        redirect_uris: uris,
        kind: "cimd".into(),
        created_at: now,
        fetched_at: Some(now),
    })
}

/// The client behind `client_id`: registered, or (an `https://` id) fetched and cached.
async fn resolve_client(st: &AppState, client_id: &str) -> Result<Client, String> {
    let now = memora_state::now();
    let known = st
        .db
        .read(|c| store::get_client(c, client_id))
        .ok()
        .flatten();
    if !client_id.starts_with("https://") {
        return known.ok_or_else(|| "unknown client_id".to_string());
    }
    if let Some(c) = known
        .as_ref()
        .filter(|c| c.fetched_at.is_some_and(|t| now - t < CIMD_TTL))
    {
        return Ok(c.clone());
    }
    let id = client_id.to_string();
    let fetched = tokio::task::spawn_blocking(move || fetch_cimd(&id, now))
        .await
        .map_err(|_| "client metadata fetch failed".to_string())?;
    match fetched {
        Ok(c) => {
            let keep = Client {
                created_at: known.as_ref().map_or(now, |k| k.created_at),
                ..c
            };
            // A new metadata client takes a row like a registration does, under
            // the same cap: this path is reachable without signing in.
            let stored = st
                .db
                .write(|tx| {
                    if known.is_none() && store::count_clients(tx)? >= store::MAX_CLIENTS {
                        store::prune(tx, now)?;
                        if store::count_clients(tx)? >= store::MAX_CLIENTS {
                            return Ok(false);
                        }
                    }
                    store::put_client(tx, &keep)?;
                    Ok(true)
                })
                .unwrap_or(false);
            if !stored && known.is_none() {
                return Err("too many registered clients".to_string());
            }
            Ok(keep)
        }
        // A cached copy beats an outage of the client's metadata host.
        Err(e) => known.ok_or(e),
    }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/// A checked authorization request.
struct AuthRequest {
    client: Client,
    redirect_uri: String,
    challenge: String,
    state: String,
    resource: Option<String>,
}

/// Why a request was refused; `redirect` is set once the redirect URI is trusted
/// (errors then go back to the client, RFC 6749 section 4.1.2.1).
struct AuthError {
    error: &'static str,
    desc: String,
    redirect: Option<String>,
}

async fn check_request(
    st: &AppState,
    q: &[(String, String)],
    base: &str,
) -> Result<AuthRequest, AuthError> {
    let fail = |error, desc: &str| AuthError {
        error,
        desc: desc.into(),
        redirect: None,
    };
    let client = resolve_client(st, param(q, "client_id"))
        .await
        .map_err(|e| fail("invalid_client", &e))?;
    let redirect_uri = param(q, "redirect_uri").to_string();
    // A client with exactly one redirect URI may omit it.
    let redirect_uri = if redirect_uri.is_empty() && client.redirect_uris.len() == 1 {
        client.redirect_uris[0].clone()
    } else {
        redirect_uri
    };
    if !client.redirect_uris.contains(&redirect_uri) {
        return Err(fail(
            "invalid_request",
            "redirect_uri is not registered for this client",
        ));
    }
    let state = param(q, "state").to_string();
    let back = |error, desc: &str| AuthError {
        error,
        desc: desc.into(),
        redirect: Some(with_query(
            &redirect_uri,
            &[
                ("error", error),
                ("error_description", desc),
                ("state", &state),
                ("iss", base),
            ],
        )),
    };
    if param(q, "response_type") != "code" {
        return Err(back(
            "unsupported_response_type",
            "only response_type=code is supported",
        ));
    }
    let challenge = param(q, "code_challenge").to_string();
    if param(q, "code_challenge_method") != "S256" || !(43..=128).contains(&challenge.len()) {
        return Err(back(
            "invalid_request",
            "PKCE with code_challenge_method=S256 is required",
        ));
    }
    let resource = Some(param(q, "resource").to_string()).filter(|r| !r.is_empty());
    if let Some(r) = &resource {
        if r.trim_end_matches('/') != format!("{base}/mcp") && r.trim_end_matches('/') != base {
            return Err(back(
                "invalid_target",
                "resource must be this server's /mcp endpoint",
            ));
        }
    }
    Ok(AuthRequest {
        client,
        redirect_uri,
        challenge,
        state,
        resource,
    })
}

/// `GET /oauth/authorize`: hand the request to the sign-in page, which shows
/// the consent card (after sign-in when needed).
async fn h_authorize(uri: Uri) -> Response {
    let q = uri.query().unwrap_or("");
    Redirect::to(&format!("/login?oauth=1&{q}")).into_response()
}

/// `GET /api/oauth/request?<authorize query>` (public): what the consent card shows.
async fn h_request_info(State(st): State<AppState>, headers: HeaderMap, uri: Uri) -> Response {
    let q = pairs(uri.query().unwrap_or(""));
    let base = base_url(&headers);
    let signed = cache::session_of(&st, &headers).map(|s| s.user);
    match check_request(&st, &q, &base).await {
        Ok(r) => {
            let host = r
                .redirect_uri
                .split("://")
                .nth(1)
                .and_then(|x| x.split(['/', '?']).next())
                .unwrap_or("")
                .to_string();
            Json(json!({
                "ok": true,
                "client": {"id": r.client.client_id, "name": r.client.name, "kind": r.client.kind},
                "redirect_host": host,
                "signed_in": signed.is_some(),
                "user": signed,
            }))
            .into_response()
        }
        Err(e) => Json(json!({"ok": false, "error": e.error, "error_description": e.desc, "redirect": e.redirect}))
            .into_response(),
    }
}

/// `POST /api/oauth/approve` `{query, allow}` (signed-in owner): `{redirect}`
/// back to the client with a code, or with `error=access_denied`.
async fn h_approve(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(user) = cache::session_of(&st, &headers).map(|s| s.user) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "sign in first"})),
        )
            .into_response();
    };
    let q = pairs(
        b.get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim_start_matches('?'),
    );
    let base = base_url(&headers);
    let r = match check_request(&st, &q, &base).await {
        Ok(r) => r,
        Err(e) => return Json(json!({"ok": false, "error": e.error, "error_description": e.desc, "redirect": e.redirect})).into_response(),
    };
    if b.get("allow").and_then(|v| v.as_bool()) != Some(true) {
        let to = with_query(
            &r.redirect_uri,
            &[
                ("error", "access_denied"),
                ("state", &r.state),
                ("iss", &base),
            ],
        );
        return Json(json!({"ok": true, "redirect": to})).into_response();
    }
    let code = memora_gateway::random_token("mcode");
    let now = memora_state::now();
    let row = store::Code {
        code_hash: memora_gateway::hash_api_key(&code),
        client_id: r.client.client_id.clone(),
        redirect_uri: r.redirect_uri.clone(),
        challenge: r.challenge.clone(),
        resource: r.resource.clone(),
        user: user.clone(),
        expires_at: now + CODE_TTL,
    };
    let res = st.db.write(|tx| {
        store::put_code(tx, &row)?;
        act_tx(tx, &headers, "oauth_approved", Some(&user), &r.client.name)
    });
    if let Err(e) = res {
        return db_err(e, "code");
    }
    let to = with_query(
        &r.redirect_uri,
        &[("code", &code), ("state", &r.state), ("iss", &base)],
    );
    Json(json!({"ok": true, "redirect": to})).into_response()
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

fn token_response(access: &str, refresh: &str) -> Response {
    let mut r = Json(json!({
        "access_token": access,
        "token_type": "Bearer",
        "refresh_token": refresh,
        "scope": "mcp",
    }))
    .into_response();
    r.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r.headers_mut()
        .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    r
}

/// Standard base64 (HTTP Basic credentials); `None` on malformed input.
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        } as u32)
    };
    let bytes: Vec<u8> = s.bytes().filter(|b| *b != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut n = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            n |= val(*c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
        if chunk.len() == 1 {
            return None;
        }
    }
    Some(out)
}

/// Form (`application/x-www-form-urlencoded`) or JSON token request, plus the
/// client id from HTTP Basic auth when the client authenticates that way.
fn token_params(headers: &HeaderMap, body: &str) -> Vec<(String, String)> {
    let json_body = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|c| c.contains("json"));
    let mut p = if json_body {
        serde_json::from_str::<Value>(body)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .map(|o| {
                o.into_iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        pairs(body.trim())
    };
    if param(&p, "client_id").is_empty() {
        let basic = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Basic "))
            .and_then(|b| base64_decode(b.trim()))
            .and_then(|raw| String::from_utf8(raw).ok());
        if let Some(id) =
            basic.and_then(|s| s.split_once(':').map(|(id, _)| crate::percent_decode(id)))
        {
            p.push(("client_id".into(), id));
        }
    }
    p
}

/// A token request that fails its checks: rolls the transaction back and is
/// answered with `invalid_grant` by [`token_failure`].
fn grant_error(reason: &str) -> memora_state::Error {
    memora_state::Error::Invalid {
        field: "grant",
        reason: reason.into(),
    }
}

/// The answer for a failed token transaction.
fn token_failure(e: memora_state::Error, what: &str) -> Response {
    match e {
        memora_state::Error::Invalid {
            field: "grant",
            reason,
        } => oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", &reason),
        e => {
            tracing::error!("oauth token: {what}: {e}");
            oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", what)
        }
    }
}

/// `POST /oauth/token`: `authorization_code` (with PKCE) or `refresh_token`.
async fn h_token(State(st): State<AppState>, headers: HeaderMap, body: String) -> Response {
    let p = token_params(&headers, &body);
    let now = memora_state::now();
    match param(&p, "grant_type") {
        "authorization_code" => {
            let code = param(&p, "code");
            let verifier = param(&p, "code_verifier");
            let client_id = param(&p, "client_id");
            let redirect = param(&p, "redirect_uri");
            let hash = memora_gateway::hash_api_key(code);
            let raw = memora_gateway::generate_key();
            let key_hash = memora_gateway::hash_api_key(&raw);
            let id = format!("k_{}", &key_hash[..8]);
            let refresh = memora_gateway::random_token("mref");
            // One transaction: a request that fails any check rolls back, so a
            // wrong client, redirect URI or verifier cannot burn a valid code.
            let res = st.db.write(|tx| {
                let Some(c) = store::take_code(tx, &hash, now)? else {
                    return Err(grant_error("unknown, used or expired code"));
                };
                if c.client_id != client_id {
                    return Err(grant_error("code was issued to another client"));
                }
                if !redirect.is_empty() && redirect != c.redirect_uri {
                    return Err(grant_error("redirect_uri does not match"));
                }
                if !memora_gateway::pkce_s256_matches(verifier, &c.challenge) {
                    return Err(grant_error("PKCE verification failed"));
                }
                let name = store::get_client(tx, &c.client_id)?
                    .map(|cl| cl.name)
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| "MCP client".into());
                let new = memora_state::keys::NewApiKey {
                    id: id.clone(),
                    name: name.chars().take(80).collect(),
                    hash: key_hash.clone(),
                    prefix: memora_gateway::key_prefix(&raw),
                    scopes: cache::scopes_from_names(
                        &memora_gateway::DEFAULT_KEY_SCOPES
                            .iter()
                            .map(|s| s.to_string())
                            .collect::<Vec<_>>(),
                    ),
                    tools: memora_state::keys::ToolGrant::All,
                };
                memora_state::keys::create(tx, &new, now)?;
                store::put_grant(
                    tx,
                    &memora_gateway::hash_api_key(&refresh),
                    &id,
                    &c.client_id,
                    now,
                )?;
                act_tx(
                    tx,
                    &headers,
                    "oauth_connected",
                    Some(&c.user),
                    &format!("{name} ({id})"),
                )
            });
            if let Err(e) = res {
                return token_failure(e, "could not create the key");
            }
            cache::reload(&st, memora_state::Domain::Keys);
            token_response(&raw, &refresh)
        }
        "refresh_token" => {
            let refresh = param(&p, "refresh_token");
            let hash = memora_gateway::hash_api_key(refresh);
            let given = param(&p, "client_id");
            let raw = memora_gateway::generate_key();
            let next = memora_gateway::random_token("mref");
            // Checked before anything is committed: a token presented by another
            // client stays valid for its own client.
            let res = st.db.write(|tx| {
                let Some((key_id, client_id)) = store::take_grant(tx, &hash)? else {
                    return Err(grant_error("unknown or used refresh token"));
                };
                if !given.is_empty() && given != client_id {
                    return Err(grant_error("refresh token belongs to another client"));
                }
                let live = memora_state::keys::get(tx, &key_id)?
                    .filter(|k| k.deleted_at.is_none() && k.enabled);
                if live.is_none() {
                    // The grant of a revoked connection is dropped for good.
                    return Ok(false);
                }
                memora_state::keys::roll(
                    tx,
                    &key_id,
                    &memora_gateway::hash_api_key(&raw),
                    &memora_gateway::key_prefix(&raw),
                )?;
                store::put_grant(
                    tx,
                    &memora_gateway::hash_api_key(&next),
                    &key_id,
                    &client_id,
                    now,
                )?;
                Ok(true)
            });
            match res {
                Ok(true) => {}
                Ok(false) => {
                    return oauth_error(
                        StatusCode::BAD_REQUEST,
                        "invalid_grant",
                        "the connection was revoked",
                    )
                }
                Err(e) => return token_failure(e, "could not refresh"),
            }
            cache::reload(&st, memora_state::Domain::Keys);
            token_response(&raw, &next)
        }
        "" => oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "grant_type is required",
        ),
        _ => oauth_error(
            StatusCode::BAD_REQUEST,
            "unsupported_grant_type",
            "use authorization_code or refresh_token",
        ),
    }
}

// ---------------------------------------------------------------------------
// Dashboard: clients and connections
// ---------------------------------------------------------------------------

/// `GET /api/oauth/clients` -> `{clients, connections:[{key_id, client_id}]}`.
async fn h_clients(State(st): State<AppState>) -> Response {
    let res = st
        .db
        .read(|c| Ok((store::list_clients(c)?, store::connections(c)?)));
    match res {
        Ok((clients, conns)) => Json(json!({
            "clients": clients,
            "connections": conns.iter().map(|(k, c)| json!({"key_id": k, "client_id": c})).collect::<Vec<_>>(),
        }))
        .into_response(),
        Err(e) => db_err(e, "clients"),
    }
}

/// `POST /api/oauth/clients` `{name, redirect_uris}`: an owner-registered client
/// ("use your own OAuth client" in Claude). -> `{client_id, ...}`.
async fn h_client_create(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let uris = match uris_of(&b) {
        Ok(u) => u,
        Err(e) => return bad(&e),
    };
    let client = Client {
        client_id: memora_gateway::random_token("mcpc")[..37].to_string(),
        name: body_str(&b, "name")
            .unwrap_or_else(|| "MCP client".into())
            .chars()
            .take(80)
            .collect(),
        redirect_uris: uris,
        kind: "manual".into(),
        created_at: memora_state::now(),
        fetched_at: None,
    };
    match st.db.write(|tx| store::put_client(tx, &client)) {
        Ok(()) => Json(json!({"ok": true, "client": client})).into_response(),
        Err(e) => db_err(e, "client"),
    }
}

/// `POST /api/oauth/clients/delete` `{client_id}`: forget a client and its refresh
/// tokens (its keys stay until deleted on the Agents page).
async fn h_client_delete(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(id) = body_str(&b, "client_id") else {
        return bad("client_id is required");
    };
    match st.db.write(|tx| store::delete_client(tx, &id)) {
        Ok(found) => Json(json!({"ok": true, "deleted": found})).into_response(),
        Err(e) => db_err(e, "client"),
    }
}

/// Paths reachable without a session or key (the flow itself and discovery).
pub(crate) fn is_public(path: &str) -> bool {
    path.starts_with("/.well-known/oauth-")
        || path == "/.well-known/openid-configuration"
        || matches!(
            path,
            "/oauth/authorize" | "/oauth/token" | "/oauth/register" | "/api/oauth/request"
        )
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            get(h_protected_resource),
        )
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            get(h_protected_resource),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            get(h_authorization_server),
        )
        .route(
            "/.well-known/oauth-authorization-server/mcp",
            get(h_authorization_server),
        )
        .route(
            "/.well-known/openid-configuration",
            get(h_authorization_server),
        )
        .route("/oauth/register", post(h_register))
        .route("/oauth/authorize", get(h_authorize))
        .route("/oauth/token", post(h_token))
        .route("/api/oauth/request", get(h_request_info))
        .route("/api/oauth/approve", post(h_approve))
        .route("/api/oauth/clients", get(h_clients).post(h_client_create))
        .route("/api/oauth/clients/delete", post(h_client_delete))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirect_uris() {
        assert!(valid_redirect("https://claude.ai/api/mcp/auth_callback"));
        assert!(valid_redirect("http://localhost:33418/callback"));
        assert!(valid_redirect("http://127.0.0.1/cb"));
        assert!(!valid_redirect("http://evil.example/cb"));
        assert!(!valid_redirect("https://x.example/cb#frag"));
        assert!(!valid_redirect("javascript:alert(1)"));
        assert!(!valid_redirect("https:///nohost"));
        assert!(!valid_redirect("http://localhost:1@evil.example/cb"));
        assert!(!valid_redirect("https://claude.ai@evil.example/cb"));
        assert!(valid_redirect("http://[::1]:8080/cb"));
    }

    /// Unknown and private hosts answer alike, so the public metadata fetch
    /// cannot be used to map internal host names.
    #[test]
    fn metadata_fetch_does_not_tell_unknown_from_private_hosts() {
        let a = fetch_cimd("https://no-such-host.invalid/client", 0).unwrap_err();
        let b = fetch_cimd("https://127.0.0.1/client", 0).unwrap_err();
        let c = fetch_cimd("https://localhost:8443/client", 0).unwrap_err();
        assert_eq!(a, b);
        assert_eq!(b, c);
    }

    #[test]
    fn public_addresses_only() {
        for ip in [
            "10.0.0.1",
            "127.0.0.1",
            "192.168.1.10",
            "169.254.169.254",
            "100.64.0.1",
            "0.1.2.3",
            "240.0.0.1",
            "::1",
            "fd00::1",
            "::ffff:10.0.0.1",
            // IPv4 inside IPv6, and other special ranges.
            "64:ff9b::a9fe:a9fe",
            "64:ff9b::7f00:1",
            "64:ff9b:1::1",
            "2002:7f00:1::1",
            "2002:c0a8:101::1",
            "::7f00:1",
            "fec0::1",
            "2001:0:4136:e378::1",
            "2001:db8::1",
            "100::1",
            "192.0.0.8",
            "198.18.0.1",
            "198.19.255.1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("1.1.1.1".parse().unwrap()));
        assert!(public_ip("2606:4700::1111".parse().unwrap()));
        // A public IPv4 host reached through NAT64 / 6to4 stays reachable.
        assert!(public_ip("64:ff9b::101:101".parse().unwrap()));
        assert!(public_ip("2002:101:101::1".parse().unwrap()));
    }

    #[test]
    fn scheme_detection() {
        let hm = |pairs: &[(&'static str, &str)]| {
            let mut m = HeaderMap::new();
            for (k, v) in pairs {
                m.insert(*k, HeaderValue::from_str(v).unwrap());
            }
            m
        };
        assert_eq!(
            base_url(&hm(&[("host", "memory.example.com")])),
            "https://memory.example.com"
        );
        assert_eq!(
            base_url(&hm(&[("host", "127.0.0.1:8400")])),
            "http://127.0.0.1:8400"
        );
        assert_eq!(
            base_url(&hm(&[("host", "192.168.1.10:8400")])),
            "http://192.168.1.10:8400"
        );
        assert_eq!(
            base_url(&hm(&[
                ("host", "a.example:8443"),
                ("x-forwarded-proto", "https")
            ])),
            "https://a.example:8443"
        );
        assert_eq!(
            base_url(&hm(&[
                ("host", "a.example:8080"),
                ("cf-visitor", "{\"scheme\":\"https\"}")
            ])),
            "https://a.example:8080"
        );
        assert_eq!(
            base_url(&hm(&[
                ("host", "a.example:81"),
                ("forwarded", "for=1.2.3.4;proto=https")
            ])),
            "https://a.example:81"
        );
        assert_eq!(
            base_url(&hm(&[("host", "a.example"), ("x-forwarded-proto", "http")])),
            "http://a.example"
        );
    }

    #[test]
    fn basic_auth_decoding() {
        assert_eq!(
            base64_decode("Y2xpZW50OnNlY3JldA==").unwrap(),
            b"client:secret"
        );
        assert_eq!(base64_decode("YQ").unwrap(), b"a");
        assert!(base64_decode("!!").is_none());
    }

    #[test]
    fn query_helpers() {
        let p = pairs("a=1&redirect_uri=https%3A%2F%2Fx%2Fcb&s=a+b");
        assert_eq!(param(&p, "redirect_uri"), "https://x/cb");
        assert_eq!(param(&p, "s"), "a b");
        assert_eq!(
            with_query("https://x/cb", &[("code", "a b"), ("state", "")]),
            "https://x/cb?code=a%20b"
        );
        assert_eq!(
            with_query("https://x/cb?q=1", &[("code", "c")]),
            "https://x/cb?q=1&code=c"
        );
    }
}

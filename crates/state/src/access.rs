//! The ordered IP / domain access stack, tables `access_policy` (one row) and
//! `access_rule`.
//!
//! Evaluation (`AccessStack::evaluate`, `would_lock_out`, CIDR / range / domain matching)
//! lives in `memora-gateway`, which converts from these row types. CIDR, range and domain
//! syntax are validated here before writing (SQL cannot check them).
use crate::{Error, Result};
use rusqlite::{params, Connection, Transaction};
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessAction {
    Allow,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleKind {
    Ip,
    Range,
    Cidr,
    Domain,
    All,
}

/// One `access_rule` row; its position in [`AccessStack::rules`] is `position`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AccessRule {
    /// 1-40 chars.
    pub id: String,
    pub kind: RuleKind,
    /// At most 255 chars; empty only for `All`.
    pub value: String,
    pub action: AccessAction,
    pub enabled: bool,
    /// At most 200 chars.
    #[serde(default)]
    pub note: String,
}

/// The whole stack: rules in evaluation order + default action.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AccessStack {
    pub rules: Vec<AccessRule>,
    /// true = allow when no rule matches.
    pub default_allow: bool,
}

impl AccessAction {
    pub fn as_str(self) -> &'static str {
        match self {
            AccessAction::Allow => "allow",
            AccessAction::Block => "block",
        }
    }

    fn parse(s: &str) -> Result<Self> {
        match s {
            "allow" => Ok(AccessAction::Allow),
            "block" => Ok(AccessAction::Block),
            other => Err(Error::invalid("action", other.to_string())),
        }
    }
}

impl RuleKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RuleKind::Ip => "ip",
            RuleKind::Range => "range",
            RuleKind::Cidr => "cidr",
            RuleKind::Domain => "domain",
            RuleKind::All => "all",
        }
    }

    fn parse(s: &str) -> Result<Self> {
        match s {
            "ip" => Ok(RuleKind::Ip),
            "range" => Ok(RuleKind::Range),
            "cidr" => Ok(RuleKind::Cidr),
            "domain" => Ok(RuleKind::Domain),
            "all" => Ok(RuleKind::All),
            other => Err(Error::invalid("kind", other.to_string())),
        }
    }
}

impl Default for AccessStack {
    /// The schema seed: no rules, allow by default.
    fn default() -> Self {
        AccessStack {
            rules: Vec::new(),
            default_allow: true,
        }
    }
}

/// Validate one rule the way `memora-gateway` will match it:
/// * `ip`: an IPv4 / IPv6 address (compared as text, so no surrounding spaces);
/// * `cidr`: `addr/bits`, bits <= 32 (IPv4) or <= 128 (IPv6);
/// * `range`: `a.b.c.d-e.f.g.h` (IPv4 only; spaces around `-` allowed);
/// * `domain`: a hostname or `*.suffix` (letters, digits, `-`, `.`; matched
///   case-insensitively);
/// * `all`: any value (legacy stacks use `*`), at most 255 chars.
pub fn validate_rule(r: &AccessRule) -> Result<()> {
    let n = r.id.chars().count();
    if n == 0 || n > 40 {
        return Err(Error::invalid(
            "rule id",
            format!("{:?}: must be 1-40 chars", r.id),
        ));
    }
    if r.value.chars().count() > 255 {
        return Err(Error::invalid("rule value", "at most 255 chars"));
    }
    if r.note.chars().count() > 200 {
        return Err(Error::invalid("rule note", "at most 200 chars"));
    }
    let v = r.value.as_str();
    let bad = |field: &'static str, why: &str| Err(Error::invalid(field, format!("{v:?}: {why}")));
    match r.kind {
        RuleKind::All => Ok(()),
        RuleKind::Ip => match v.parse::<IpAddr>() {
            Ok(_) => Ok(()),
            Err(_) => bad("ip", "not an IP address"),
        },
        RuleKind::Cidr => {
            let Some((net, bits)) = v.split_once('/') else {
                return bad("cidr", "expected address/bits");
            };
            let (Ok(net), Ok(bits)) = (net.parse::<IpAddr>(), bits.parse::<u8>()) else {
                return bad("cidr", "expected address/bits");
            };
            let max = if net.is_ipv4() { 32 } else { 128 };
            if bits > max {
                return bad("cidr", &format!("prefix length must be 0-{max}"));
            }
            Ok(())
        }
        RuleKind::Range => {
            let Some((a, b)) = v.split_once('-') else {
                return bad("range", "expected first-last (IPv4)");
            };
            match (a.trim().parse::<Ipv4Addr>(), b.trim().parse::<Ipv4Addr>()) {
                (Ok(_), Ok(_)) => Ok(()),
                _ => bad("range", "expected first-last (IPv4)"),
            }
        }
        RuleKind::Domain => {
            let host = v.trim().strip_prefix("*.").unwrap_or(v.trim());
            let ok = !host.is_empty()
                && host.len() <= 253
                && host.split('.').all(|l| {
                    !l.is_empty()
                        && l.len() <= 63
                        && !l.starts_with('-')
                        && !l.ends_with('-')
                        && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                });
            if ok {
                Ok(())
            } else {
                bad("domain", "expected a hostname or *.suffix")
            }
        }
    }
}

/// Load the stack ordered by `position`.
pub fn load(conn: &Connection) -> Result<AccessStack> {
    let default_allow: bool = conn
        .query_row(
            "SELECT default_allow FROM access_policy WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(true),
            e => Err(e),
        })?;
    let mut stmt = conn.prepare(
        "SELECT id, kind, value, action, enabled, note FROM access_rule ORDER BY position",
    )?;
    let raw = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, bool>(4)?,
            r.get::<_, String>(5)?,
        ))
    })?;
    let mut rules = Vec::new();
    for row in raw {
        let (id, kind, value, action, enabled, note) = row?;
        rules.push(AccessRule {
            id,
            kind: RuleKind::parse(&kind)?,
            value,
            action: AccessAction::parse(&action)?,
            enabled,
            note,
        });
    }
    Ok(AccessStack {
        rules,
        default_allow,
    })
}

/// Replace the whole stack (rules renumbered 0..n in order) in `tx`. Validates rule syntax
/// and unique ids first (`Error::Invalid`); nothing is written when any rule is rejected.
pub fn save(tx: &Transaction<'_>, stack: &AccessStack) -> Result<()> {
    let mut seen = HashSet::new();
    for r in &stack.rules {
        validate_rule(r)?;
        if !seen.insert(r.id.as_str()) {
            return Err(Error::invalid(
                "rule id",
                format!("{:?} is used twice", r.id),
            ));
        }
    }
    tx.execute(
        "INSERT INTO access_policy (id, default_allow) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET default_allow = excluded.default_allow
         WHERE default_allow IS NOT excluded.default_allow",
        params![stack.default_allow],
    )?;
    tx.execute("DELETE FROM access_rule", [])?;
    let mut ins = tx.prepare(
        "INSERT INTO access_rule (id, position, kind, value, action, enabled, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for (pos, r) in stack.rules.iter().enumerate() {
        ins.execute(params![
            r.id,
            pos as i64,
            r.kind.as_str(),
            r.value,
            r.action.as_str(),
            r.enabled,
            r.note
        ])?;
    }
    Ok(())
}

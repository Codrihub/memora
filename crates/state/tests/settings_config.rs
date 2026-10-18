//! Settings, server_config and provisioning. Tests touching the process
//! environment take ENV_LOCK (tests in one binary run on parallel threads).

use memora_state::config::{self, Provision, ProvisionKey, ENV_KEY_ID};
use memora_state::settings::{self, SettingsPatch, DEFAULT_VAULT};
use memora_state::{owner, Db, Domain, Error};
use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());
const ARGON_A: &str = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaEE";
const ARGON_B: &str = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaEI";
const KEY_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn is_invalid(r: Result<impl std::fmt::Debug, Error>, field: &str) {
    match r {
        Err(Error::Invalid { field: f, .. }) => assert_eq!(f, field),
        other => panic!("expected Invalid({field}), got {other:?}"),
    }
}

// ---------------------------------------------------------------- settings

#[test]
fn settings_defaults_and_update() {
    let db = Db::open_temp().unwrap();
    let s = db.read(settings::get).unwrap();
    assert_eq!(s.realm, "Memora");
    assert_eq!(
        (s.session_ttl, s.session_max_age, s.min_password_len),
        (10800, 0, 10)
    );
    assert_eq!(s.vault_path, None);

    let patch = SettingsPatch {
        realm: Some("  Home  ".into()),
        session_ttl: Some(600),
        session_max_age: Some(3600),
        min_password_len: Some(12),
    };
    let s = db.write(|tx| settings::update(tx, &patch, 77)).unwrap();
    assert_eq!(s, db.read(settings::get).unwrap());
    assert_eq!(
        (
            s.realm.as_str(),
            s.session_ttl,
            s.session_max_age,
            s.min_password_len,
            s.updated_at
        ),
        ("Home", 600, 3600, 12, 77)
    );

    // empty patch keeps values
    let s2 = db
        .write(|tx| settings::update(tx, &SettingsPatch::default(), 78))
        .unwrap();
    assert_eq!(s2.realm, "Home");
    assert_eq!(s2.updated_at, 78);
}

#[test]
fn settings_update_validation() {
    let db = Db::open_temp().unwrap();
    let up = |p: SettingsPatch| db.write(|tx| settings::update(tx, &p, 1));
    is_invalid(
        up(SettingsPatch {
            realm: Some(" ".into()),
            ..Default::default()
        }),
        "realm",
    );
    is_invalid(
        up(SettingsPatch {
            realm: Some("x".repeat(65)),
            ..Default::default()
        }),
        "realm",
    );
    is_invalid(
        up(SettingsPatch {
            session_ttl: Some(299),
            ..Default::default()
        }),
        "session_ttl",
    );
    is_invalid(
        up(SettingsPatch {
            session_ttl: Some(2_592_001),
            ..Default::default()
        }),
        "session_ttl",
    );
    is_invalid(
        up(SettingsPatch {
            min_password_len: Some(9),
            ..Default::default()
        }),
        "min_password_len",
    );
    is_invalid(
        up(SettingsPatch {
            min_password_len: Some(257),
            ..Default::default()
        }),
        "min_password_len",
    );
    // max_age below the (current) ttl
    is_invalid(
        up(SettingsPatch {
            session_max_age: Some(600),
            ..Default::default()
        }),
        "session_max_age",
    );
    // raising ttl above an existing cap
    up(SettingsPatch {
        session_max_age: Some(20000),
        ..Default::default()
    })
    .unwrap();
    is_invalid(
        up(SettingsPatch {
            session_ttl: Some(30000),
            ..Default::default()
        }),
        "session_max_age",
    );
    // both together is fine; 0 means no cap
    up(SettingsPatch {
        session_ttl: Some(30000),
        session_max_age: Some(0),
        ..Default::default()
    })
    .unwrap();
    let s = db.read(settings::get).unwrap();
    assert_eq!((s.session_ttl, s.session_max_age), (30000, 0));
    // a rejected patch writes nothing
    is_invalid(
        up(SettingsPatch {
            realm: Some("New".into()),
            session_ttl: Some(1),
            ..Default::default()
        }),
        "session_ttl",
    );
    assert_eq!(db.read(settings::get).unwrap().realm, "Memora");
}

#[test]
fn vault_configured_suggested_resolved() {
    let _g = env_lock();
    std::env::remove_var("MEMORA_VAULT");
    let db = Db::open_temp().unwrap();
    assert_eq!(db.read(settings::configured_vault).unwrap(), None);
    assert_eq!(db.read(settings::suggested_vault).unwrap(), None);
    assert_eq!(db.read(settings::resolve_vault).unwrap(), DEFAULT_VAULT);

    std::env::set_var("MEMORA_VAULT", " /env/vault ");
    assert_eq!(
        db.read(settings::suggested_vault).unwrap().as_deref(),
        Some("/env/vault")
    );
    assert_eq!(db.read(settings::resolve_vault).unwrap(), "/env/vault");
    // a server_config row wins over the process env
    db.write(|tx| config::set(tx, "MEMORA_VAULT", Some("/row/vault"), 1))
        .unwrap();
    assert_eq!(db.read(settings::resolve_vault).unwrap(), "/row/vault");

    db.write(|tx| settings::set_vault(tx, Some(" /srv/notes "), 5))
        .unwrap();
    assert_eq!(
        db.read(settings::configured_vault).unwrap().as_deref(),
        Some("/srv/notes")
    );
    assert_eq!(db.read(settings::resolve_vault).unwrap(), "/srv/notes");
    assert_eq!(db.read(settings::get).unwrap().updated_at, 5);

    is_invalid(
        db.write(|tx| settings::set_vault(tx, Some("relative/dir"), 6)),
        "vault_path",
    );
    is_invalid(
        db.write(|tx| settings::set_vault(tx, Some(&format!("/{}", "a".repeat(4096))), 6)),
        "vault_path",
    );
    db.write(|tx| settings::set_vault(tx, Some("  "), 7))
        .unwrap();
    assert_eq!(db.read(settings::configured_vault).unwrap(), None);
    db.write(|tx| settings::set_vault(tx, Some("/x"), 8))
        .unwrap();
    db.write(|tx| settings::set_vault(tx, None, 9)).unwrap();
    assert_eq!(db.read(settings::configured_vault).unwrap(), None);
    std::env::remove_var("MEMORA_VAULT");
}

// ---------------------------------------------------------------- server_config

#[test]
fn config_set_get_list_delete() {
    let db = Db::open_temp().unwrap();
    assert!(db.read(config::list).unwrap().is_empty());
    db.write(|tx| config::set(tx, "RUST_LOG", Some(" debug "), 10))
        .unwrap();
    db.write(|tx| config::set(tx, "MEMORA_PORT", Some("8400"), 11))
        .unwrap();
    assert_eq!(
        db.read(|c| config::get(c, "RUST_LOG")).unwrap().as_deref(),
        Some("debug")
    );
    assert_eq!(db.read(|c| config::get(c, "MEMORA_BIND")).unwrap(), None);
    let l = db.read(config::list).unwrap();
    let keys: Vec<_> = l.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(keys, ["MEMORA_PORT", "RUST_LOG"], "CONFIG_KEYS order");
    assert_eq!(l[0].updated_at, 11);

    db.write(|tx| config::set(tx, "MEMORA_PORT", Some("8401"), 12))
        .unwrap();
    assert_eq!(
        db.read(|c| config::get(c, "MEMORA_PORT"))
            .unwrap()
            .as_deref(),
        Some("8401")
    );
    db.write(|tx| config::set(tx, "MEMORA_PORT", Some(""), 13))
        .unwrap();
    db.write(|tx| config::set(tx, "RUST_LOG", None, 13))
        .unwrap();
    db.write(|tx| config::set(tx, "RUST_LOG", None, 13))
        .unwrap(); // deleting twice is fine
    assert!(db.read(config::list).unwrap().is_empty());
}

#[test]
fn config_rejects_unknown_secret_and_bad_values() {
    let db = Db::open_temp().unwrap();
    let set = |k: &str, v: Option<&str>| db.write(|tx| config::set(tx, k, v, 1));
    is_invalid(set("MEMORA_NOPE", Some("1")), "config key");
    is_invalid(set("MEMORA_NOPE", None), "config key");
    is_invalid(set("MEMORA_STATE", Some("/x")), "config key");
    for secret in config::SECRET_ENV_KEYS {
        is_invalid(set(secret, Some("hunter2hunter2")), "config key");
        is_invalid(set(secret, None), "config key");
    }
    for bad in ["0", "65536", "80a", "-1", "+80", "8 0"] {
        is_invalid(set("MEMORA_PORT", Some(bad)), "config value");
    }
    for bad in ["29", "86401", "abc"] {
        is_invalid(set("MEMORA_ARM_TTL", Some(bad)), "config value");
    }
    is_invalid(set("MEMORA_VAULT_AUTO", Some("maybe")), "config value");
    is_invalid(set("RUST_LOG", Some(&"x".repeat(2049))), "config value");
    is_invalid(set("RUST_LOG", Some("a\nb")), "config value");
    is_invalid(set("MEMORA_BIND", Some("a\0b")), "config value");
    is_invalid(set("MEMORA_ADMIN_USER", Some("bad user")), "username");
    assert!(db.read(config::list).unwrap().is_empty());

    // normalisation
    set("MEMORA_VAULT_AUTO", Some("YES")).unwrap();
    set("MEMORA_ADMIN_USER", Some("Root")).unwrap();
    set("MEMORA_ARM_TTL", Some("30")).unwrap();
    set("MEMORA_PORT", Some("65535")).unwrap();
    let get = |k| db.read(|c| config::get(c, k)).unwrap();
    assert_eq!(get("MEMORA_VAULT_AUTO").as_deref(), Some("true"));
    assert_eq!(get("MEMORA_ADMIN_USER").as_deref(), Some("root"));
    set("MEMORA_VAULT_AUTO", Some("off")).unwrap();
    assert_eq!(get("MEMORA_VAULT_AUTO").as_deref(), Some("false"));
    assert!(config::validate("MEMORA_PORT", "443").is_ok());
    assert!(config::check_key("MEMORA_API_KEY").is_err());
    assert!(config::is_known_key("RUST_LOG") && !config::is_known_key("MEMORA_API_KEY"));
}

#[test]
fn every_config_key_is_storable() {
    let db = Db::open_temp().unwrap();
    for (k, _) in config::CONFIG_KEYS {
        let v = match *k {
            "MEMORA_PORT" => "8400",
            "MEMORA_ARM_TTL" => "300",
            "MEMORA_VAULT_AUTO" => "true",
            "MEMORA_ADMIN_USER" => "admin",
            _ => "/some/value",
        };
        db.write(|tx| config::set(tx, k, Some(v), 1)).unwrap();
    }
    assert_eq!(
        db.read(config::list).unwrap().len(),
        config::CONFIG_KEYS.len()
    );
}

#[test]
fn config_effective_and_apply_to_env() {
    let _g = env_lock();
    let db = Db::open_temp().unwrap();
    std::env::remove_var("MEMORA_BIND");
    std::env::remove_var("MEMORA_TRUSTED_PROXIES");
    std::env::remove_var("MEMORA_DOMAIN");
    let eff = |k| db.read(|c| config::effective(c, k)).unwrap();
    // default
    assert_eq!(eff("MEMORA_BIND").as_deref(), Some("127.0.0.1"));
    assert_eq!(eff("MEMORA_DOMAIN"), None);
    assert_eq!(config::default_value("MEMORA_PORT"), Some("8400"));
    // env beats default, empty env is "unset"
    std::env::set_var("MEMORA_BIND", "0.0.0.0");
    assert_eq!(eff("MEMORA_BIND").as_deref(), Some("0.0.0.0"));
    std::env::set_var("MEMORA_BIND", " ");
    assert_eq!(eff("MEMORA_BIND").as_deref(), Some("127.0.0.1"));
    // row beats env
    std::env::set_var("MEMORA_BIND", "0.0.0.0");
    db.write(|tx| config::set(tx, "MEMORA_BIND", Some("10.0.0.5"), 1))
        .unwrap();
    assert_eq!(eff("MEMORA_BIND").as_deref(), Some("10.0.0.5"));

    db.write(|tx| config::set(tx, "MEMORA_TRUSTED_PROXIES", Some("10.0.0.1"), 1))
        .unwrap();
    let applied = db.read(config::apply_to_env).unwrap();
    assert_eq!(applied, ["MEMORA_BIND", "MEMORA_TRUSTED_PROXIES"]);
    assert_eq!(std::env::var("MEMORA_BIND").unwrap(), "10.0.0.5");
    assert_eq!(std::env::var("MEMORA_TRUSTED_PROXIES").unwrap(), "10.0.0.1");
    // keys without a row are left alone
    std::env::set_var("MEMORA_DOMAIN", "keep.example");
    db.read(config::apply_to_env).unwrap();
    assert_eq!(std::env::var("MEMORA_DOMAIN").unwrap(), "keep.example");
    // an imported empty row removes the variable
    db.write(|tx| {
        tx.execute(
            "INSERT INTO server_config (key, value, updated_at) VALUES ('MEMORA_DOMAIN', '', 1)",
            [],
        )?;
        Ok(())
    })
    .unwrap();
    let applied = db.read(config::apply_to_env).unwrap();
    assert!(!applied.contains(&"MEMORA_DOMAIN".to_string()));
    assert!(std::env::var("MEMORA_DOMAIN").is_err());

    for k in ["MEMORA_BIND", "MEMORA_TRUSTED_PROXIES", "MEMORA_DOMAIN"] {
        std::env::remove_var(k);
    }
}

#[test]
fn config_changes_bump_settings_revision() {
    let db = Db::open_temp().unwrap();
    db.changed_domains().unwrap();
    let other = Db::open(db.state_dir()).unwrap();
    other
        .write(|tx| config::set(tx, "RUST_LOG", Some("info"), 1))
        .unwrap();
    assert_eq!(db.changed_domains().unwrap(), [Domain::Settings]);
    // setting the same value again is not a change
    other
        .write(|tx| config::set(tx, "RUST_LOG", Some("info"), 2))
        .unwrap();
    assert!(db.changed_domains().unwrap().is_empty());
    other
        .write(|tx| settings::set_vault(tx, Some("/v"), 3))
        .unwrap();
    assert_eq!(db.changed_domains().unwrap(), [Domain::Settings]);
}

// ---------------------------------------------------------------- provision

fn key(hash: &str) -> ProvisionKey {
    ProvisionKey {
        hash: hash.into(),
        prefix: "memora_live_".into(),
    }
}

fn env_key_row(db: &Db) -> Option<(String, i64, Option<i64>, Vec<String>)> {
    db.read(|c| {
        let row = c.query_row(
            "SELECT hash, enabled, deleted_at FROM api_key WHERE id = ?1",
            [ENV_KEY_ID],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                ))
            },
        );
        let (h, e, d) = match row {
            Ok(x) => x,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        let mut st =
            c.prepare("SELECT scope FROM api_key_scope WHERE key_id = ?1 ORDER BY scope")?;
        let scopes = st
            .query_map([ENV_KEY_ID], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(Some((h, e, d, scopes)))
    })
    .unwrap()
}

#[test]
fn provision_empty_does_nothing() {
    let db = Db::open_temp().unwrap();
    let log = db
        .write(|tx| config::provision(tx, &Provision::default(), 1))
        .unwrap();
    assert!(log.is_empty());
    assert_eq!(db.read(owner::get).unwrap(), None);
    assert_eq!(env_key_row(&db), None);
}

#[test]
fn provision_is_idempotent_and_never_overwrites_owner() {
    let db = Db::open_temp().unwrap();
    let input = Provision {
        owner: Some(("Admin".into(), ARGON_A.into())),
        api_key: Some(key(KEY_A)),
        vault_auto: Some("/data".into()),
    };
    let log = db.write(|tx| config::provision(tx, &input, 100)).unwrap();
    assert_eq!(
        log,
        [
            "owner admin created from the environment",
            "default API key installed from MEMORA_API_KEY",
            "vault set to /data (MEMORA_VAULT_AUTO)",
        ]
    );
    let o = db.read(owner::get).unwrap().unwrap();
    assert_eq!(
        (o.username.as_str(), o.password_hash.as_str()),
        ("admin", ARGON_A)
    );
    let (h, enabled, deleted, scopes) = env_key_row(&db).unwrap();
    assert_eq!((h.as_str(), enabled, deleted), (KEY_A, 1, None));
    assert_eq!(scopes, ["mcp", "read", "write"]);
    assert_eq!(
        db.read(settings::configured_vault).unwrap().as_deref(),
        Some("/data")
    );

    // second run: owner kept, key unchanged, vault kept
    let again = Provision {
        owner: Some(("other".into(), ARGON_B.into())),
        api_key: Some(key(KEY_A)),
        vault_auto: Some("/elsewhere".into()),
    };
    let log = db.write(|tx| config::provision(tx, &again, 200)).unwrap();
    assert_eq!(
        log,
        ["MEMORA_ADMIN_PASSWORD ignored: owner admin already exists"]
    );
    let o = db.read(owner::get).unwrap().unwrap();
    assert_eq!(
        (o.username.as_str(), o.password_hash.as_str()),
        ("admin", ARGON_A)
    );
    assert_eq!(
        db.read(settings::configured_vault).unwrap().as_deref(),
        Some("/data")
    );
    let owners: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM owner", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(owners, 1);
}

#[test]
fn provision_key_replaced_on_new_hash_or_trash() {
    let db = Db::open_temp().unwrap();
    let p = |h: &str| Provision {
        api_key: Some(key(h)),
        ..Default::default()
    };
    db.write(|tx| config::provision(tx, &p(KEY_A), 1)).unwrap();
    // operator narrows the key: same hash keeps the edit
    db.write(|tx| {
        tx.execute(
            "DELETE FROM api_key_scope WHERE key_id = ?1 AND scope = 'write'",
            [ENV_KEY_ID],
        )?;
        Ok(())
    })
    .unwrap();
    assert!(db
        .write(|tx| config::provision(tx, &p(KEY_A), 2))
        .unwrap()
        .is_empty());
    assert_eq!(env_key_row(&db).unwrap().3, ["mcp", "read"]);
    // new hash: replaced with defaults, one row, stale sealed copy dropped
    let sealed = "s".repeat(40);
    db.write(|tx| memora_state::keys::put_secret(tx, ENV_KEY_ID, &sealed))
        .unwrap();
    let log = db.write(|tx| config::provision(tx, &p(KEY_B), 3)).unwrap();
    assert_eq!(log, ["default API key installed from MEMORA_API_KEY"]);
    let (h, _, _, scopes) = env_key_row(&db).unwrap();
    assert_eq!((h.as_str(), scopes.len()), (KEY_B, 3));
    assert_eq!(
        db.read(|c| memora_state::keys::get_secret(c, ENV_KEY_ID))
            .unwrap(),
        None
    );
    // trashed: reinstalled (as with gateway.json)
    db.write(|tx| {
        tx.execute(
            "UPDATE api_key SET deleted_at = 10, enabled = 0 WHERE id = ?1",
            [ENV_KEY_ID],
        )?;
        Ok(())
    })
    .unwrap();
    db.write(|tx| config::provision(tx, &p(KEY_B), 11)).unwrap();
    let (_, enabled, deleted, _) = env_key_row(&db).unwrap();
    assert_eq!((enabled, deleted), (1, None));
    let n: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM api_key", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 1);
    // malformed input is a caller bug -> error, nothing written
    is_invalid(
        db.write(|tx| config::provision(tx, &p("xyz"), 12)),
        "api_key hash",
    );
    let bad_prefix = Provision {
        api_key: Some(ProvisionKey {
            hash: KEY_A.into(),
            prefix: "ab".into(),
        }),
        ..Default::default()
    };
    is_invalid(
        db.write(|tx| config::provision(tx, &bad_prefix, 12)),
        "api_key prefix",
    );
}

#[test]
fn provision_reports_bad_user_and_relative_vault() {
    let db = Db::open_temp().unwrap();
    let input = Provision {
        owner: Some(("bad user".into(), ARGON_A.into())),
        api_key: None,
        vault_auto: Some("data".into()),
    };
    let log = db.write(|tx| config::provision(tx, &input, 1)).unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(
        log[0],
        "MEMORA_ADMIN_USER is not a valid username; no owner created"
    );
    assert!(
        log[1].starts_with("MEMORA_VAULT_AUTO: ") && log[1].ends_with("vault left unset"),
        "{}",
        log[1]
    );
    assert_eq!(db.read(owner::get).unwrap(), None);
    assert_eq!(db.read(settings::configured_vault).unwrap(), None);
}

//! Arm window / LOCKED / burn repository.

use memora_state::arm::{self, ArmBurn, ArmMode, ArmStatus, CodeCheck};
use memora_state::{Db, Domain, Error};

const CODE: &str = "c0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0de";
const OTHER: &str = "0000000000000000000000000000000000000000000000000000000000000000";

fn state(db: &Db, now: i64) -> arm::ArmWindow {
    db.write(|tx| arm::state(tx, now)).unwrap()
}

fn code_hash(db: &Db) -> Option<String> {
    db.read(|c| Ok(c.query_row("SELECT code_hash FROM arm_state", [], |r| r.get(0))?))
        .unwrap()
}

#[test]
fn fresh_is_idle() {
    let db = Db::open_temp().unwrap();
    let w = db.read(arm::get).unwrap();
    assert_eq!(w.status, ArmStatus::Idle);
    assert_eq!(
        (w.mode, w.armed_at, w.ttl, w.locked_at, w.last_burn.clone()),
        (None, None, None, None, None)
    );
    assert_eq!(w.remaining(0), 0);
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, CODE, 10)).unwrap(),
        CodeCheck::NoWindow
    );
    assert_eq!(ArmMode::parse("reset"), Some(ArmMode::Reset));
    assert_eq!(ArmMode::parse("x"), None);
}

#[test]
fn arm_validates_input() {
    let db = Db::open_temp().unwrap();
    for ttl in [29, 86401, 0, -5] {
        let e = db
            .write(|tx| arm::arm(tx, ArmMode::Bootstrap, ttl, CODE, 1))
            .unwrap_err();
        assert!(matches!(e, Error::Invalid { field: "ttl", .. }));
    }
    for bad in [
        "",
        "abc",
        &CODE.to_uppercase(),
        &format!("{}g", &CODE[..63]),
    ] {
        let e = db
            .write(|tx| arm::arm(tx, ArmMode::Bootstrap, 300, bad, 1))
            .unwrap_err();
        assert!(matches!(
            e,
            Error::Invalid {
                field: "code_hash",
                ..
            }
        ));
    }
    db.write(|tx| arm::arm(tx, ArmMode::Bootstrap, 30, CODE, 1))
        .unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Reset, 86400, CODE, 1))
        .unwrap();
}

#[test]
fn arm_verify_disarm() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Reset, 300, CODE, 1000))
        .unwrap();
    let w = state(&db, 1100);
    assert_eq!(w.status, ArmStatus::Armed);
    assert_eq!(
        (w.mode, w.armed_at, w.ttl),
        (Some(ArmMode::Reset), Some(1000), Some(300))
    );
    assert_eq!(w.remaining(1100), 200);
    assert_eq!(w.remaining(5000), 0);

    assert_eq!(
        db.write(|tx| arm::verify_code(tx, CODE, 1100)).unwrap(),
        CodeCheck::Valid
    );
    // the boundary second is still open (expiry is armed_at + ttl < now)
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, CODE, 1300)).unwrap(),
        CodeCheck::Valid
    );
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, OTHER, 1100)).unwrap(),
        CodeCheck::Wrong
    );
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, "", 1100)).unwrap(),
        CodeCheck::Wrong
    );

    // consume: verify + disarm in one transaction -> the code works once
    let r = db
        .write(|tx| {
            let c = arm::verify_code(tx, CODE, 1100)?;
            arm::disarm(tx)?;
            Ok(c)
        })
        .unwrap();
    assert_eq!(r, CodeCheck::Valid);
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, CODE, 1100)).unwrap(),
        CodeCheck::NoWindow
    );
    let w = state(&db, 1100);
    assert_eq!(w.status, ArmStatus::Idle);
    assert_eq!((w.mode, w.armed_at, w.ttl), (None, None, None));
    assert_eq!(code_hash(&db), None);
}

#[test]
fn rearm_replaces_code() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Bootstrap, 300, CODE, 1))
        .unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Bootstrap, 300, OTHER, 2))
        .unwrap();
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, CODE, 3)).unwrap(),
        CodeCheck::Wrong
    );
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, OTHER, 3)).unwrap(),
        CodeCheck::Valid
    );
}

#[test]
fn expired_window_locks() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Bootstrap, 60, CODE, 1000))
        .unwrap();
    assert!(!db.write(|tx| arm::expire(tx, 1060)).unwrap());
    assert!(db.write(|tx| arm::expire(tx, 1061)).unwrap());
    assert!(!db.write(|tx| arm::expire(tx, 1062)).unwrap(), "only once");
    let w = db.read(arm::get).unwrap();
    assert_eq!(w.status, ArmStatus::Locked);
    assert_eq!(w.locked_at, Some(1061));
    assert_eq!(
        (w.mode, w.armed_at, w.ttl),
        (Some(ArmMode::Bootstrap), Some(1000), Some(60))
    );
    assert_eq!(w.remaining(1061), 0);
    assert_eq!(code_hash(&db), None, "code dies with the window");

    // state() does the expiry itself; verify_code fails closed afterwards
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Reset, 60, CODE, 1000))
        .unwrap();
    assert_eq!(
        db.read(arm::get).unwrap().status,
        ArmStatus::Armed,
        "get applies no expiry"
    );
    assert_eq!(state(&db, 2000).status, ArmStatus::Locked);
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Reset, 60, CODE, 1000))
        .unwrap();
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, CODE, 2000)).unwrap(),
        CodeCheck::NoWindow
    );
    assert_eq!(db.read(arm::get).unwrap().status, ArmStatus::Locked);
}

#[test]
fn burn_records_and_next_arm_clears() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Reset, 300, CODE, 1000))
        .unwrap();
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, OTHER, 1010)).unwrap(),
        CodeCheck::Wrong
    );
    db.write(|tx| arm::burn(tx, "203.0.113.9", 1010)).unwrap();
    let w = state(&db, 1020);
    assert_eq!(w.status, ArmStatus::Idle, "burn closes without locking");
    assert_eq!(w.mode, None);
    assert_eq!(
        w.last_burn,
        Some(ArmBurn {
            at: 1010,
            ip: "203.0.113.9".into(),
            mode: Some(ArmMode::Reset)
        })
    );
    assert_eq!(code_hash(&db), None);
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, CODE, 1020)).unwrap(),
        CodeCheck::NoWindow
    );

    db.write(|tx| arm::arm(tx, ArmMode::Bootstrap, 300, CODE, 2000))
        .unwrap();
    let w = state(&db, 2000);
    assert_eq!(w.status, ArmStatus::Armed);
    assert_eq!(w.last_burn, None, "a new window clears the last burn");
}

#[test]
fn burn_while_idle_or_locked() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::burn(tx, "1.2.3.4", 5)).unwrap();
    let w = db.read(arm::get).unwrap();
    assert_eq!(w.status, ArmStatus::Idle);
    assert_eq!(
        w.last_burn,
        Some(ArmBurn {
            at: 5,
            ip: "1.2.3.4".into(),
            mode: None
        })
    );

    db.write(|tx| arm::lock(tx, 10)).unwrap();
    db.write(|tx| arm::burn(tx, "1.2.3.5", 11)).unwrap();
    let w = db.read(arm::get).unwrap();
    assert_eq!(w.status, ArmStatus::Locked, "burn does not unlock");
    assert_eq!(w.last_burn.unwrap().at, 11);

    // burning an expired window locks it first
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Bootstrap, 30, CODE, 100))
        .unwrap();
    db.write(|tx| arm::burn(tx, "9.9.9.9", 500)).unwrap();
    let w = db.read(arm::get).unwrap();
    assert_eq!(w.status, ArmStatus::Locked);
    assert_eq!(w.last_burn.unwrap().mode, Some(ArmMode::Bootstrap));
}

#[test]
fn lock_unlock_disarm() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| arm::lock(tx, 50)).unwrap();
    let w = db.read(arm::get).unwrap();
    assert_eq!((w.status, w.locked_at), (ArmStatus::Locked, Some(50)));
    db.write(arm::disarm).unwrap();
    assert_eq!(
        db.read(arm::get).unwrap().status,
        ArmStatus::Locked,
        "disarm keeps LOCKED"
    );
    db.write(arm::unlock).unwrap();
    let w = db.read(arm::get).unwrap();
    assert_eq!((w.status, w.locked_at), (ArmStatus::Idle, None));
    db.write(arm::unlock).unwrap(); // idempotent
    db.write(arm::disarm).unwrap();

    // lock closes an open window
    db.write(|tx| arm::arm(tx, ArmMode::Reset, 300, CODE, 100))
        .unwrap();
    db.write(|tx| arm::lock(tx, 110)).unwrap();
    assert_eq!(code_hash(&db), None);
    assert_eq!(
        db.write(|tx| arm::verify_code(tx, CODE, 120)).unwrap(),
        CodeCheck::NoWindow
    );
    // unlock does not touch an open window
    db.write(|tx| arm::arm(tx, ArmMode::Reset, 300, CODE, 200))
        .unwrap();
    db.write(arm::unlock).unwrap();
    assert_eq!(db.read(arm::get).unwrap().status, ArmStatus::Armed);
    // arming clears the lock
    db.write(|tx| arm::lock(tx, 300)).unwrap();
    db.write(|tx| arm::arm(tx, ArmMode::Reset, 300, CODE, 301))
        .unwrap();
    let w = db.read(arm::get).unwrap();
    assert_eq!((w.status, w.locked_at), (ArmStatus::Armed, None));
}

#[test]
fn arm_changes_bump_revision() {
    let db = Db::open_temp().unwrap();
    db.changed_domains().unwrap();
    let other = Db::open(db.state_dir()).unwrap();
    other
        .write(|tx| arm::arm(tx, ArmMode::Bootstrap, 300, CODE, 1))
        .unwrap();
    assert!(db.changed_domains().unwrap().contains(&Domain::Arm));
}

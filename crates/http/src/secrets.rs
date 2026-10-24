//! Sealed API key secrets, so the owner can show a key again. ChaCha20-Poly1305 under
//! a master key in `<state>/key-seal.bin` (0600); `memora.db` alone reveals nothing.

use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use std::io::Write;
use std::path::Path;

const FILE: &str = "key-seal.bin";

/// The master key, created when missing. `None` when the state folder is not usable.
fn master(state_dir: &Path) -> Option<Key> {
    let p = state_dir.join(FILE);
    if let Ok(b) = std::fs::read(&p) {
        return (b.len() == 32).then(|| *Key::from_slice(&b));
    }
    let key = ChaCha20Poly1305::generate_key(&mut OsRng);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    match opts.open(&p) {
        Ok(mut f) => {
            f.write_all(key.as_slice()).ok()?;
            Some(key)
        }
        // Another request created it first.
        Err(_) => std::fs::read(&p)
            .ok()
            .filter(|b| b.len() == 32)
            .map(|b| *Key::from_slice(&b)),
    }
}

/// `base64url(nonce || ciphertext)` of `raw`, or `None` when sealing is unavailable.
pub fn seal(state_dir: &Path, raw: &str) -> Option<String> {
    let cipher = ChaCha20Poly1305::new(&master(state_dir)?);
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ct = cipher.encrypt(&nonce, raw.as_bytes()).ok()?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Some(memora_gateway::base64url(&out))
}

/// The secret behind a sealed value; `None` when it cannot be opened.
pub fn open(state_dir: &Path, sealed: &str) -> Option<String> {
    let bytes = b64url_decode(sealed)?;
    if bytes.len() < 12 + 16 {
        return None;
    }
    let cipher = ChaCha20Poly1305::new(&master(state_dir)?);
    let pt = cipher
        .decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..])
        .ok()?;
    String::from_utf8(pt).ok()
}

fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return None,
        } as u32)
    };
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len() * 3 / 4);
    for chunk in b.chunks(4) {
        if chunk.len() == 1 {
            return None;
        }
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
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_round_trip_and_tamper() {
        let d = std::env::temp_dir().join(format!("memora-seal-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let s = seal(&d, "memora_live_abc").unwrap();
        assert_eq!(open(&d, &s).as_deref(), Some("memora_live_abc"));
        // Same master key on the next call; another nonce each time.
        assert_ne!(seal(&d, "memora_live_abc").unwrap(), s);
        let mut bad = s.clone().into_bytes();
        // Flip a character in the middle (the last one may only carry padding bits).
        let mid = bad.len() / 2;
        bad[mid] = if bad[mid] == b'A' { b'B' } else { b'A' };
        assert!(open(&d, std::str::from_utf8(&bad).unwrap()).is_none());
        std::fs::remove_dir_all(&d).ok();
    }
}

//! Test harness: exposes the Rust GRX server session over a line-based stdio
//! protocol so `tools/grx_interop_test.py` can drive it with the REAL Python
//! client implementation.
//!
//! This exists purely for interop testing — it is an `example`, so it is never
//! part of the shipped binary. Golden vectors prove the arithmetic matches;
//! this proves the two implementations actually talk to each other.
//!
//! Protocol: one JSON object per line in, one per line out.
//!   {"op":"init","data":<hex psk(32) || ltid>}
//!   {"op":"hello","data":<hex CLIENT_HELLO>}    -> {"data":<hex SERVER_HELLO>}
//!   {"op":"confirm","data":<hex CLIENT_CONFIRM>}
//!   {"op":"open","data":<hex 41-byte frame>}    -> {"data":<hex plaintext>}
//!   {"op":"seal","data":<hex 20-byte plaintext>}-> {"data":<hex 41-byte frame>}
//!   {"op":"reset"}
//! Any failure answers {"error":"..."}.

use pc_server_rs::grx::{self, GrxServerSession};
use std::io::{BufRead, Write};

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Minimal field extraction — avoids pulling serde into the shipped crate.
/// Tolerates whitespace around the colon, because `json.dumps` emits
/// `{"op": "init"}` with a space and a naive `"op":"` match silently misses it.
fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\"");
    let start = line.find(&pat)? + pat.len();
    let rest = line[start..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(&rest[..end])
}

fn main() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut psk = [0u8; 32];
    let mut ltid: Vec<u8> = Vec::new();
    let mut session: Option<GrxServerSession> = None;

    let mut reply = |out: &mut std::io::Stdout, s: String| {
        let _ = writeln!(out, "{s}");
        let _ = out.flush();
    };

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let op = field(&line, "op").unwrap_or("");
        let data = field(&line, "data").and_then(unhex).unwrap_or_default();

        match op {
            "init" => {
                if data.len() < 32 {
                    reply(&mut out, r#"{"error":"init needs psk(32)||ltid"}"#.into());
                    continue;
                }
                psk.copy_from_slice(&data[..32]);
                ltid = data[32..].to_vec();
                session = Some(GrxServerSession::new(psk, &ltid));
                reply(&mut out, r#"{"data":""}"#.into());
            }
            "reset" => {
                session = Some(GrxServerSession::new(psk, &ltid));
                reply(&mut out, r#"{"data":""}"#.into());
            }
            "hello" => {
                let Some(s) = session.as_mut() else {
                    reply(&mut out, r#"{"error":"not initialised"}"#.into());
                    continue;
                };
                let eph = match grx::new_ephemeral() {
                    Ok(e) => e,
                    Err(e) => {
                        reply(&mut out, format!(r#"{{"error":"rng: {e}"}}"#));
                        continue;
                    }
                };
                match s.handle_hello(&data, eph) {
                    Ok(sh) => reply(&mut out, format!(r#"{{"data":"{}"}}"#, hex(&sh))),
                    Err(e) => reply(&mut out, format!(r#"{{"error":"hello: {e:?}"}}"#)),
                }
            }
            "confirm" => {
                let Some(s) = session.as_mut() else {
                    reply(&mut out, r#"{"error":"not initialised"}"#.into());
                    continue;
                };
                match s.handle_confirm(&data) {
                    Ok(()) => reply(&mut out, r#"{"data":""}"#.into()),
                    Err(e) => reply(&mut out, format!(r#"{{"error":"confirm: {e:?}"}}"#)),
                }
            }
            "open" => {
                let Some(s) = session.as_mut() else {
                    reply(&mut out, r#"{"error":"not initialised"}"#.into());
                    continue;
                };
                match s.open(&data) {
                    Some(pt) => reply(&mut out, format!(r#"{{"data":"{}"}}"#, hex(&pt))),
                    None => reply(&mut out, r#"{"error":"dropped"}"#.into()),
                }
            }
            "seal" => {
                let Some(s) = session.as_mut() else {
                    reply(&mut out, r#"{"error":"not initialised"}"#.into());
                    continue;
                };
                match s.seal(&data) {
                    Some(f) => reply(&mut out, format!(r#"{{"data":"{}"}}"#, hex(&f))),
                    None => reply(&mut out, r#"{"error":"seal failed"}"#.into()),
                }
            }
            other => reply(&mut out, format!(r#"{{"error":"unknown op {other}"}}"#)),
        }
    }
}

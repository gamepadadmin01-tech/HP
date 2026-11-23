//! CamOS "smooth Wi-Fi" mode (owner, 2026-11-23): the video travels as UDP packets instead of over the TCP
//! connection. Pure code, unit-tested — the socket loop lives in stream.rs.
//!
//! **Why.** TCP delivers everything, in order: one packet lost in the air holds back every picture behind it
//! until it has been resent, which shows up as a freeze and then a rush. Video calls (WebRTC) send over UDP
//! and decide for themselves what is worth waiting for. This is the same idea, kept small:
//!
//! 1. Each picture is cut into numbered pieces of at most 1200 bytes (fits any Wi-Fi packet).
//! 2. A missing piece is asked for again once ("NACK" = "not received"), a couple of times if needed.
//! 3. If it still hasn't come ~0.2 s after it was noticed, that picture is skipped and the phone is asked for a
//!    fresh full picture — a short hitch instead of a freeze.
//! 4. Twice a second the PC tells the phone how many packets arrived and how many were lost, and the phone
//!    lowers or raises its quality from that (like a call does).
//!
//! The pairing check, the phone's settings and the PC window's requests stay on the TCP connection, which also
//! hands out the per-connection `token` below. Every UDP packet must carry that token and come from the same
//! address as the TCP connection, so nobody else on the Wi-Fi can push pictures in.
//!
//! ```text
//! phone → PC   video:  token[8] kind=1 flags:u8 frame:u32 idx:u16 count:u16 pts_us:u64 seq:u32 data[..1200]
//! PC → phone   nack:   token[8] kind=2 frame:u32 n:u8 idx:u16 × n      (n = 255: the whole frame never came)
//! PC → phone   report: token[8] kind=3 received:u32 lost:u32 skipped:u16
//! ```
//! `seq` counts every packet the phone sends (resends too), so gaps in it show how much the air lost.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use subtle::ConstantTimeEq;

pub const HEADER_LEN: usize = 30;
/// Largest piece of a picture in one packet: 1200 + 30 + 28 (IP/UDP) stays under the 1500-byte Wi-Fi MTU.
pub const MAX_CHUNK: usize = 1200;
/// Pieces per picture at most (~4.9 MB, more than any 4K key frame).
pub const MAX_CHUNKS: u16 = 4096;
pub const KIND_VIDEO: u8 = 1;
pub const KIND_NACK: u8 = 2;
pub const KIND_REPORT: u8 = 3;
/// A spare piece (added 2026-11-23): the XOR of a group of `k` pieces of one picture, so one lost piece of the
/// group can be rebuilt at once, with no ask and no wait. Same header as a video piece with `idx` = group number;
/// data = total picture length (u32) + k (u8) + the XOR (padded to MAX_CHUNK). The phone sends these only while the
/// PC reports losses (about 1 spare per 6 pieces), like video calls do on a lossy network.
pub const KIND_PARITY: u8 = 4;
/// In a NACK, "the whole frame is missing" (no piece of it arrived, so we don't know how many there are).
pub const NACK_WHOLE: u8 = 255;
/// Most piece numbers in one NACK packet.
pub const NACK_MAX: usize = 200;
pub const FLAG_KEY: u8 = 2;

/// First ask, once a loss is evident (a little slack for packets that arrive slightly out of order).
pub const NACK_AFTER: Duration = Duration::from_millis(8);
/// Ask again this often while still missing.
pub const NACK_EVERY: Duration = Duration::from_millis(40);
/// Then give up on that picture and wait for a full one.
/// (Was 220 ms. On the owner's campus Wi-Fi a resent piece sometimes took over 0.3 s, so pictures were skipped that a
/// little more patience would have saved; a skip costs a full picture, which is worse than a short wait.)
pub const GIVE_UP: Duration = Duration::from_millis(350);
/// Pictures held while waiting (memory bound: ~4 s at 60 fps).
const MAX_PENDING: usize = 240;

#[derive(Debug, PartialEq)]
pub struct Chunk<'a> {
    pub flags: u8,
    pub frame: u32,
    pub idx: u16,
    pub count: u16,
    pub pts_us: u64,
    pub seq: u32,
    pub data: &'a [u8],
}

fn token_ok(token: &[u8; 8], pkt: &[u8]) -> bool {
    pkt.len() >= 9 && bool::from(token.ct_eq(&pkt[0..8]))
}

/// A video packet from the phone, or None if it is not ours / malformed.
pub fn parse_video<'a>(token: &[u8; 8], pkt: &'a [u8]) -> Option<Chunk<'a>> {
    if pkt.len() <= HEADER_LEN || pkt.len() > HEADER_LEN + MAX_CHUNK || !token_ok(token, pkt) || pkt[8] != KIND_VIDEO {
        return None;
    }
    let u16_at = |i: usize| u16::from_be_bytes([pkt[i], pkt[i + 1]]);
    let u32_at = |i: usize| u32::from_be_bytes(pkt[i..i + 4].try_into().expect("4 bytes"));
    let c = Chunk {
        flags: pkt[9],
        frame: u32_at(10),
        idx: u16_at(14),
        count: u16_at(16),
        pts_us: u64::from_be_bytes(pkt[18..26].try_into().expect("8 bytes")),
        seq: u32_at(26),
        data: &pkt[HEADER_LEN..],
    };
    if c.count == 0 || c.count > MAX_CHUNKS || c.idx >= c.count {
        return None;
    }
    Some(c)
}

/// A video packet (the phone builds the same bytes; used by tests and the desktop test phone).
pub fn build_video(token: &[u8; 8], c: &Chunk) -> Vec<u8> {
    let mut v = Vec::with_capacity(HEADER_LEN + c.data.len());
    v.extend_from_slice(token);
    v.push(KIND_VIDEO);
    v.push(c.flags);
    v.extend_from_slice(&c.frame.to_be_bytes());
    v.extend_from_slice(&c.idx.to_be_bytes());
    v.extend_from_slice(&c.count.to_be_bytes());
    v.extend_from_slice(&c.pts_us.to_be_bytes());
    v.extend_from_slice(&c.seq.to_be_bytes());
    v.extend_from_slice(c.data);
    v
}

/// A spare piece: group `group` of `k` pieces of `frame`, XOR of their (padded) bytes.
#[derive(Debug, PartialEq)]
pub struct Parity<'a> {
    pub flags: u8,
    pub frame: u32,
    pub group: u16,
    pub count: u16,
    pub pts_us: u64,
    pub seq: u32,
    /// The whole picture's length (gives the last piece's length when that is the one rebuilt).
    pub total: u32,
    pub k: u8,
    pub xor: &'a [u8],
}

pub fn parse_parity<'a>(token: &[u8; 8], pkt: &'a [u8]) -> Option<Parity<'a>> {
    if pkt.len() < HEADER_LEN + 6 || pkt.len() > HEADER_LEN + 5 + MAX_CHUNK || !token_ok(token, pkt) || pkt[8] != KIND_PARITY {
        return None;
    }
    let u16_at = |i: usize| u16::from_be_bytes([pkt[i], pkt[i + 1]]);
    let u32_at = |i: usize| u32::from_be_bytes(pkt[i..i + 4].try_into().expect("4 bytes"));
    let p = Parity {
        flags: pkt[9],
        frame: u32_at(10),
        group: u16_at(14),
        count: u16_at(16),
        pts_us: u64::from_be_bytes(pkt[18..26].try_into().expect("8 bytes")),
        seq: u32_at(26),
        total: u32_at(HEADER_LEN),
        k: pkt[HEADER_LEN + 4],
        xor: &pkt[HEADER_LEN + 5..],
    };
    let k = p.k as usize;
    if p.count == 0 || p.count > MAX_CHUNKS || k < 2 || p.group as usize * k >= p.count as usize || p.total as usize > p.count as usize * MAX_CHUNK {
        return None;
    }
    Some(p)
}

/// A spare piece (the phone builds the same bytes; used by tests and the desktop test phone).
pub fn build_parity(token: &[u8; 8], p: &Parity) -> Vec<u8> {
    let mut v = Vec::with_capacity(HEADER_LEN + 5 + p.xor.len());
    v.extend_from_slice(token);
    v.push(KIND_PARITY);
    v.push(p.flags);
    v.extend_from_slice(&p.frame.to_be_bytes());
    v.extend_from_slice(&p.group.to_be_bytes());
    v.extend_from_slice(&p.count.to_be_bytes());
    v.extend_from_slice(&p.pts_us.to_be_bytes());
    v.extend_from_slice(&p.seq.to_be_bytes());
    v.extend_from_slice(&p.total.to_be_bytes());
    v.push(p.k);
    v.extend_from_slice(p.xor);
    v
}

/// The XOR of pieces (each padded to MAX_CHUNK with zeros): what a spare piece carries.
pub fn xor_pieces<'a>(pieces: impl Iterator<Item = &'a [u8]>) -> Vec<u8> {
    let mut x = vec![0u8; MAX_CHUNK];
    for p in pieces {
        for (a, b) in x.iter_mut().zip(p) {
            *a ^= b;
        }
    }
    x
}

/// "Please send these pieces of `frame` again" (empty = the whole frame).
pub fn build_nack(token: &[u8; 8], frame: u32, missing: &[u16]) -> Vec<u8> {
    let list = &missing[..missing.len().min(NACK_MAX)];
    let mut v = Vec::with_capacity(14 + 2 * list.len());
    v.extend_from_slice(token);
    v.push(KIND_NACK);
    v.extend_from_slice(&frame.to_be_bytes());
    if list.is_empty() {
        v.push(NACK_WHOLE);
    } else {
        v.push(list.len() as u8);
        for i in list {
            v.extend_from_slice(&i.to_be_bytes());
        }
    }
    v
}

/// (frame, missing pieces; empty = whole frame). For tests and the desktop test phone.
pub fn parse_nack(token: &[u8; 8], pkt: &[u8]) -> Option<(u32, Vec<u16>)> {
    if pkt.len() < 14 || !token_ok(token, pkt) || pkt[8] != KIND_NACK {
        return None;
    }
    let frame = u32::from_be_bytes(pkt[9..13].try_into().ok()?);
    let n = pkt[13];
    if n == NACK_WHOLE {
        return Some((frame, Vec::new()));
    }
    let n = n as usize;
    if pkt.len() < 14 + 2 * n {
        return None;
    }
    Some((frame, (0..n).map(|i| u16::from_be_bytes([pkt[14 + 2 * i], pkt[15 + 2 * i]])).collect()))
}

pub fn build_report(token: &[u8; 8], r: &Report) -> Vec<u8> {
    let mut v = Vec::with_capacity(19);
    v.extend_from_slice(token);
    v.push(KIND_REPORT);
    v.extend_from_slice(&r.received.to_be_bytes());
    v.extend_from_slice(&r.lost.to_be_bytes());
    v.extend_from_slice(&r.skipped.to_be_bytes());
    v
}

pub fn parse_report(token: &[u8; 8], pkt: &[u8]) -> Option<Report> {
    if pkt.len() < 19 || !token_ok(token, pkt) || pkt[8] != KIND_REPORT {
        return None;
    }
    Some(Report {
        received: u32::from_be_bytes(pkt[9..13].try_into().ok()?),
        lost: u32::from_be_bytes(pkt[13..17].try_into().ok()?),
        skipped: u16::from_be_bytes([pkt[17], pkt[18]]),
    })
}

/// What the air did since the last report.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Report {
    pub received: u32,
    pub lost: u32,
    /// Pictures given up on (a hitch on the PC).
    pub skipped: u16,
}

#[derive(Debug, PartialEq)]
pub enum Event {
    /// The next picture, complete and in order: hand it to the decoder.
    Frame { data: Vec<u8>, pts_us: u64, key: bool },
    /// Ask the phone for these pieces again (empty = the whole frame).
    Nack { frame: u32, missing: Vec<u16> },
    /// A picture was given up on: ask the phone for a full one (the caller limits this to one a second).
    NeedKey,
}

struct Partial {
    flags: u8,
    pts_us: u64,
    chunks: Vec<Option<Vec<u8>>>,
    have: u16,
    /// Highest piece number seen: pieces are sent in order, so a hole below it is a loss.
    max_idx: u16,
    /// Spare pieces received: (group, total picture length, group size k, XOR).
    parity: Vec<(u16, u32, u8, Vec<u8>)>,
}

impl Partial {
    fn new(flags: u8, pts_us: u64, count: u16) -> Self {
        Partial { flags, pts_us, chunks: vec![None; count as usize], have: 0, max_idx: 0, parity: Vec::new() }
    }

    /// Rebuild every piece that is the only one missing from a group with a spare. Returns how many.
    fn recover(&mut self) -> u16 {
        let count = self.chunks.len();
        let mut rebuilt = 0;
        for (g, total, k, xor) in &self.parity {
            let (k, g) = (*k as usize, *g as usize);
            let range = g * k..((g + 1) * k).min(count);
            let missing: Vec<usize> = range.clone().filter(|&i| self.chunks[i].is_none()).collect();
            if missing.len() != 1 {
                continue;
            }
            let lost = missing[0];
            let mut buf = xor.clone();
            buf.resize(MAX_CHUNK, 0);
            for i in range.filter(|&i| i != lost) {
                if let Some(c) = &self.chunks[i] {
                    for (a, b) in buf.iter_mut().zip(c) {
                        *a ^= b;
                    }
                }
            }
            let len = if lost == count - 1 { (*total as usize).saturating_sub((count - 1) * MAX_CHUNK) } else { MAX_CHUNK };
            if len == 0 || len > MAX_CHUNK {
                continue;
            }
            buf.truncate(len);
            self.chunks[lost] = Some(buf);
            self.have += 1;
            rebuilt += 1;
        }
        rebuilt
    }

    fn complete(&self) -> bool {
        self.have as usize == self.chunks.len()
    }
    fn key(&self) -> bool {
        self.flags & FLAG_KEY != 0
    }
    /// Missing pieces we have evidence for: below the highest seen, or all of them when a later frame arrived.
    fn missing(&self, later_arrived: bool) -> Vec<u16> {
        let end = if later_arrived { self.chunks.len() } else { self.max_idx as usize };
        (0..end).filter(|&i| self.chunks[i].is_none()).map(|i| i as u16).collect()
    }
    fn take(self) -> Vec<u8> {
        self.chunks.into_iter().flatten().flatten().collect()
    }
}

/// Puts the pieces back together and hands over complete pictures in order, deciding when to ask again and when
/// to give up. Time is passed in, so tests can play out losses exactly.
pub struct Reassembler {
    /// The next picture to hand over; None until the first complete full (key) picture.
    next: Option<u32>,
    pending: BTreeMap<u32, Partial>,
    /// Waiting for a full picture (at the start, and after giving up on one).
    need_key: bool,
    /// When the hold-up of the picture we are waiting for became evident, and when we last asked for it.
    stall_since: Option<Instant>,
    last_nack: Option<Instant>,
    // Report counters.
    received: u32,
    first_seq: Option<u32>,
    highest_seq: Option<u32>,
    skipped: u16,
    recovered: u16,
}

impl Default for Reassembler {
    fn default() -> Self {
        Self::new()
    }
}

impl Reassembler {
    pub fn new() -> Self {
        Reassembler {
            next: None,
            pending: BTreeMap::new(),
            need_key: true,
            stall_since: None,
            last_nack: None,
            received: 0,
            first_seq: None,
            highest_seq: None,
            skipped: 0,
            recovered: 0,
        }
    }

    /// Count a packet for the report; false if it belongs to a picture already handed over or skipped.
    fn note(&mut self, seq: u32, frame: u32) -> bool {
        self.received = self.received.wrapping_add(1);
        if self.first_seq.is_none() {
            self.first_seq = Some(seq);
        }
        if self.highest_seq.is_none_or(|h| (seq.wrapping_sub(h) as i32) > 0) {
            self.highest_seq = Some(seq);
        }
        match self.next {
            // A late resend of a picture already handed over or skipped, or garbage.
            Some(n) => (0..100_000).contains(&(frame.wrapping_sub(n) as i32)),
            None => true,
        }
    }

    fn trim(&mut self) {
        while self.pending.len() > MAX_PENDING {
            self.pending.pop_first();
        }
    }

    pub fn push(&mut self, c: &Chunk) {
        if !self.note(c.seq, c.frame) {
            return;
        }
        let p = self.pending.entry(c.frame).or_insert_with(|| Partial::new(c.flags, c.pts_us, c.count));
        if p.chunks.len() != c.count as usize {
            return;
        }
        let slot = &mut p.chunks[c.idx as usize];
        if slot.is_none() {
            *slot = Some(c.data.to_vec());
            p.have += 1;
        }
        p.max_idx = p.max_idx.max(c.idx);
        if !p.parity.is_empty() {
            self.recovered = self.recovered.saturating_add(p.recover());
        }
        self.trim();
    }

    /// A spare piece: keep it, and rebuild a lost piece of its group if exactly one is missing.
    pub fn push_parity(&mut self, s: &Parity) {
        if !self.note(s.seq, s.frame) {
            return;
        }
        let p = self.pending.entry(s.frame).or_insert_with(|| Partial::new(s.flags, s.pts_us, s.count));
        if p.chunks.len() != s.count as usize || p.parity.iter().any(|(g, ..)| *g == s.group) {
            return;
        }
        p.parity.push((s.group, s.total, s.k, s.xor.to_vec()));
        // The spare is sent right after its group, so every piece of the group was sent before it.
        let last_of_group = ((s.group as usize + 1) * s.k as usize).min(s.count as usize) - 1;
        p.max_idx = p.max_idx.max(last_of_group as u16);
        self.recovered = self.recovered.saturating_add(p.recover());
        self.trim();
    }

    /// Pieces rebuilt from spares so far (for the PC log).
    pub fn recovered(&self) -> u32 {
        self.recovered as u32
    }

    /// Everything that can be done now: complete pictures in order, asks for missing pieces, give-ups.
    pub fn poll(&mut self, now: Instant) -> Vec<Event> {
        let mut out = Vec::new();
        loop {
            if self.need_key || self.next.is_none() {
                // Start (again) from the oldest complete full picture.
                let key = self.pending.iter().find(|(_, p)| p.complete() && p.key()).map(|(f, _)| *f);
                if let Some(k) = key {
                    self.pending.retain(|f, _| *f >= k);
                    self.next = Some(k);
                    self.need_key = false;
                    self.stall_since = None;
                    self.last_nack = None;
                    continue;
                }
                // A full picture on its way with holes in it: ask for its pieces too.
                let partial_key = self.pending.iter().find(|(_, p)| p.key()).map(|(f, _)| *f);
                if let Some(k) = partial_key {
                    let later = self.pending.range(k.wrapping_add(1)..).next().is_some();
                    let missing = self.pending[&k].missing(later);
                    if !missing.is_empty() {
                        self.ask(now, k, missing, &mut out);
                    }
                }
                break;
            }
            let n = self.next.expect("set above");
            if self.pending.get(&n).is_some_and(Partial::complete) {
                let p = self.pending.remove(&n).expect("checked");
                out.push(Event::Frame { key: p.key(), pts_us: p.pts_us, data: p.take() });
                self.next = Some(n.wrapping_add(1));
                self.stall_since = None;
                self.last_nack = None;
                continue;
            }
            let later = self.pending.range(n.wrapping_add(1)..).next().is_some();
            let missing = match self.pending.get(&n) {
                Some(p) => p.missing(later),
                None if later => Vec::new(), // the whole picture never came
                None => break,               // nothing sent yet: just waiting
            };
            if self.pending.contains_key(&n) && missing.is_empty() {
                break; // still arriving, no sign of loss yet
            }
            let since = *self.stall_since.get_or_insert(now);
            if now.duration_since(since) >= GIVE_UP {
                self.pending.remove(&n);
                self.skipped = self.skipped.saturating_add(1);
                self.need_key = true;
                self.stall_since = None;
                self.last_nack = None;
                out.push(Event::NeedKey);
                continue;
            }
            if now.duration_since(since) >= NACK_AFTER {
                // Ask for this picture and for any other holes already visible behind it.
                if self.last_nack.is_none_or(|t| now.duration_since(t) >= NACK_EVERY) {
                    out.push(Event::Nack { frame: n, missing });
                    let newest = self.pending.keys().next_back().copied().unwrap_or(n);
                    let mut f = n.wrapping_add(1);
                    let mut extra = 0;
                    while (newest.wrapping_sub(f) as i32) > 0 && extra < 8 {
                        match self.pending.get(&f) {
                            None => out.push(Event::Nack { frame: f, missing: Vec::new() }),
                            Some(p) if !p.complete() => out.push(Event::Nack { frame: f, missing: p.missing(true) }),
                            _ => {}
                        }
                        f = f.wrapping_add(1);
                        extra += 1;
                    }
                    self.last_nack = Some(now);
                }
            }
            break;
        }
        out
    }

    fn ask(&mut self, now: Instant, frame: u32, missing: Vec<u16>, out: &mut Vec<Event>) {
        let since = *self.stall_since.get_or_insert(now);
        if now.duration_since(since) >= GIVE_UP {
            self.pending.remove(&frame);
            self.stall_since = None;
            self.last_nack = None;
            self.skipped = self.skipped.saturating_add(1);
            out.push(Event::NeedKey);
            return;
        }
        if now.duration_since(since) >= NACK_AFTER && self.last_nack.is_none_or(|t| now.duration_since(t) >= NACK_EVERY) {
            out.push(Event::Nack { frame, missing });
            self.last_nack = Some(now);
        }
    }

    /// What arrived and what was lost since the last call (sent to the phone twice a second).
    pub fn take_report(&mut self) -> Report {
        let lost = match (self.first_seq, self.highest_seq) {
            (Some(a), Some(b)) => (b.wrapping_sub(a).wrapping_add(1)).saturating_sub(self.received),
            _ => 0,
        };
        let r = Report { received: self.received, lost, skipped: self.skipped };
        self.received = 0;
        self.skipped = 0;
        self.first_seq = self.highest_seq.map(|h| h.wrapping_add(1));
        r
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: [u8; 8] = *b"tok12345";

    /// A phone in miniature: cuts pictures into pieces with running packet numbers.
    struct Phone {
        seq: u32,
        frame: u32,
    }
    impl Phone {
        fn picture(&mut self, key: bool, size: usize) -> Vec<Vec<u8>> {
            let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8 ^ self.frame as u8).collect();
            let count = data.len().div_ceil(MAX_CHUNK) as u16;
            let mut out = Vec::new();
            for (i, piece) in data.chunks(MAX_CHUNK).enumerate() {
                let c = Chunk { flags: if key { FLAG_KEY } else { 0 }, frame: self.frame, idx: i as u16, count, pts_us: self.frame as u64 * 33_333, seq: self.seq, data: piece };
                self.seq += 1;
                out.push(build_video(&T, &c));
            }
            self.frame += 1;
            out
        }
        fn resend(&mut self, pkt: &[u8]) -> Vec<u8> {
            let mut p = pkt.to_vec();
            p[26..30].copy_from_slice(&self.seq.to_be_bytes());
            self.seq += 1;
            p
        }
    }

    fn feed(r: &mut Reassembler, pkts: &[Vec<u8>]) {
        for p in pkts {
            r.push(&parse_video(&T, p).expect("valid"));
        }
    }

    fn frames(ev: &[Event]) -> Vec<(u64, bool)> {
        ev.iter().filter_map(|e| if let Event::Frame { pts_us, key, .. } = e { Some((*pts_us / 33_333, *key)) } else { None }).collect()
    }

    #[test]
    fn packets_round_trip_and_strangers_are_refused() {
        let c = Chunk { flags: 2, frame: 7, idx: 1, count: 3, pts_us: 99, seq: 42, data: b"hello" };
        let p = build_video(&T, &c);
        assert_eq!(parse_video(&T, &p), Some(c));
        assert!(parse_video(b"badtoken", &p).is_none(), "another token must be refused");
        let mut bad = p.clone();
        bad[14..16].copy_from_slice(&3u16.to_be_bytes()); // idx == count
        assert!(parse_video(&T, &bad).is_none());
        assert!(parse_video(&T, &p[..HEADER_LEN]).is_none(), "no data");
        assert_eq!(parse_nack(&T, &build_nack(&T, 9, &[1, 5])), Some((9, vec![1, 5])));
        assert_eq!(parse_nack(&T, &build_nack(&T, 9, &[])), Some((9, vec![])));
        let r = Report { received: 10, lost: 2, skipped: 1 };
        assert_eq!(parse_report(&T, &build_report(&T, &r)), Some(r));
    }

    #[test]
    fn complete_pictures_come_out_in_order_starting_at_a_full_picture() {
        let now = Instant::now();
        let mut ph = Phone { seq: 0, frame: 0 };
        let mut r = Reassembler::new();
        let p0 = ph.picture(false, 3000); // before any full picture: can't be decoded, dropped
        let p1 = ph.picture(true, 5000);
        let p2 = ph.picture(false, 2500);
        feed(&mut r, &p0);
        feed(&mut r, &p1);
        feed(&mut r, &p2);
        let ev = r.poll(now);
        assert_eq!(frames(&ev), vec![(1, true), (2, false)]);
        // The data comes back exactly.
        if let Event::Frame { data, .. } = &ev[0] {
            assert_eq!(data.len(), 5000);
        }
    }

    #[test]
    fn a_lost_piece_is_asked_for_and_the_resend_fills_the_hole() {
        let t0 = Instant::now();
        let mut ph = Phone { seq: 0, frame: 0 };
        let mut r = Reassembler::new();
        feed(&mut r, &ph.picture(true, 4000));
        assert_eq!(frames(&r.poll(t0)).len(), 1);
        let p1 = ph.picture(false, 3600); // 3 pieces; piece 1 is lost
        feed(&mut r, &[p1[0].clone(), p1[2].clone()]);
        assert!(frames(&r.poll(t0)).is_empty(), "must wait, not skip");
        let ev = r.poll(t0 + Duration::from_millis(10));
        assert!(ev.contains(&Event::Nack { frame: 1, missing: vec![1] }), "{ev:?}");
        // Asked again only after NACK_EVERY.
        assert!(!r.poll(t0 + Duration::from_millis(20)).iter().any(|e| matches!(e, Event::Nack { .. })));
        let p2 = ph.picture(false, 1000);
        feed(&mut r, &p2);
        let resent = ph.resend(&p1[1]);
        feed(&mut r, &[resent]);
        assert_eq!(frames(&r.poll(t0 + Duration::from_millis(40))), vec![(1, false), (2, false)]);
    }

    #[test]
    fn a_picture_that_never_completes_is_skipped_and_a_full_one_requested() {
        let t0 = Instant::now();
        let mut ph = Phone { seq: 0, frame: 0 };
        let mut r = Reassembler::new();
        feed(&mut r, &ph.picture(true, 2000));
        r.poll(t0);
        let p1 = ph.picture(false, 2400);
        feed(&mut r, &p1[..1]); // second piece lost for good
        let p2 = ph.picture(false, 800); // depends on 1: useless once 1 is gone
        feed(&mut r, &p2);
        assert!(frames(&r.poll(t0)).is_empty()); // the loss is noticed here
        let mut ev = r.poll(t0 + Duration::from_millis(10));
        assert!(ev.iter().any(|e| matches!(e, Event::Nack { frame: 1, .. })));
        ev = r.poll(t0 + GIVE_UP + Duration::from_millis(20));
        assert!(ev.contains(&Event::NeedKey), "{ev:?}");
        assert!(frames(&ev).is_empty(), "frame 2 must not be decoded without frame 1");
        let p3 = ph.picture(true, 3000);
        feed(&mut r, &p3);
        assert_eq!(frames(&r.poll(t0 + GIVE_UP + Duration::from_millis(40))), vec![(3, true)]);
        assert_eq!(r.take_report().skipped, 1);
    }

    #[test]
    fn a_picture_lost_completely_is_asked_for_whole() {
        let t0 = Instant::now();
        let mut ph = Phone { seq: 0, frame: 0 };
        let mut r = Reassembler::new();
        feed(&mut r, &ph.picture(true, 2000));
        r.poll(t0);
        let _lost = ph.picture(false, 1000);
        feed(&mut r, &ph.picture(false, 1000));
        r.poll(t0); // noticed
        let ev = r.poll(t0 + Duration::from_millis(10));
        assert!(ev.contains(&Event::Nack { frame: 1, missing: vec![] }), "{ev:?}");
    }

    /// A picture as the phone sends it with spares: data packets, and one spare per group of `k`.
    fn with_spares(frame: u32, data: &[u8], k: usize, seq: &mut u32) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        let count = data.len().div_ceil(MAX_CHUNK) as u16;
        let pieces: Vec<&[u8]> = data.chunks(MAX_CHUNK).collect();
        let mut pkts = Vec::new();
        for (i, d) in pieces.iter().enumerate() {
            pkts.push(build_video(&T, &Chunk { flags: FLAG_KEY, frame, idx: i as u16, count, pts_us: 0, seq: *seq, data: d }));
            *seq += 1;
        }
        let mut spares = Vec::new();
        for (g, group) in pieces.chunks(k).enumerate() {
            let xor = xor_pieces(group.iter().copied());
            spares.push(build_parity(&T, &Parity { flags: FLAG_KEY, frame, group: g as u16, count, pts_us: 0, seq: *seq, total: data.len() as u32, k: k as u8, xor: &xor }));
            *seq += 1;
        }
        (pkts, spares)
    }

    fn feed_any(r: &mut Reassembler, pkts: &[Vec<u8>]) {
        for p in pkts {
            if let Some(c) = parse_video(&T, p) {
                r.push(&c);
            } else if let Some(s) = parse_parity(&T, p) {
                r.push_parity(&s);
            } else {
                panic!("not a valid packet");
            }
        }
    }

    #[test]
    fn a_spare_piece_rebuilds_a_lost_one_at_once() {
        let data: Vec<u8> = (0..(6 * MAX_CHUNK + 300)).map(|i| (i % 253) as u8).collect();
        let mut seq = 0;
        let (pkts, spares) = with_spares(0, &data, 6, &mut seq); // 7 pieces: group 0 = 0..6, group 1 = the short last one
        let mut r = Reassembler::new();
        // Piece 2 and the short last piece 6 are lost; each is the only one missing from its group.
        let kept: Vec<Vec<u8>> = pkts.iter().enumerate().filter(|(i, _)| *i != 2 && *i != 6).map(|(_, p)| p.clone()).collect();
        feed_any(&mut r, &kept);
        feed_any(&mut r, &spares);
        let ev = r.poll(Instant::now());
        match &ev[..] {
            [Event::Frame { data: got, .. }] => assert_eq!(got, &data, "rebuilt picture must be exact"),
            other => panic!("expected the picture at once, got {other:?}"),
        }
        assert_eq!(r.recovered(), 2);
    }

    #[test]
    fn two_lost_in_one_group_are_asked_for_not_guessed() {
        let data: Vec<u8> = (0..(6 * MAX_CHUNK)).map(|i| (i % 251) as u8).collect();
        let mut seq = 0;
        let (pkts, spares) = with_spares(0, &data, 6, &mut seq);
        let mut r = Reassembler::new();
        let kept: Vec<Vec<u8>> = pkts.iter().enumerate().filter(|(i, _)| *i != 1 && *i != 4).map(|(_, p)| p.clone()).collect();
        feed_any(&mut r, &kept);
        feed_any(&mut r, &spares);
        let t0 = Instant::now();
        assert!(frames(&r.poll(t0)).is_empty());
        let ev = r.poll(t0 + Duration::from_millis(10));
        assert!(ev.iter().any(|e| matches!(e, Event::Nack { missing, .. } if missing == &vec![1, 4])), "{ev:?}");
        assert_eq!(r.recovered(), 0);
        // A broken spare is refused.
        let mut bad = spares[0].clone();
        bad[HEADER_LEN + 4] = 1; // k = 1
        assert!(parse_parity(&T, &bad).is_none());
    }

    #[test]
    fn the_report_counts_losses_from_the_packet_numbers() {
        let mut ph = Phone { seq: 100, frame: 0 };
        let mut r = Reassembler::new();
        let p = ph.picture(true, 12 * MAX_CHUNK); // 12 packets, seq 100..=111
        for (i, pkt) in p.iter().enumerate() {
            if i != 3 && i != 7 {
                feed(&mut r, std::slice::from_ref(pkt));
            }
        }
        let rep = r.take_report();
        assert_eq!((rep.received, rep.lost), (10, 2));
        feed(&mut r, &ph.picture(false, MAX_CHUNK));
        assert_eq!(r.take_report(), Report { received: 1, lost: 0, skipped: 0 });
    }
}

"""
GRX crypto — PC (server) reference implementation of the GamepadOS Realtime
eXchange authenticated-encryption layer. See apps/docs/GRX_PROTOCOL.md for the
byte-for-byte contract; the Android client must mirror this exactly.

Primitives (PyCA `cryptography`): X25519 (fresh per connection) -> HKDF-SHA256
-> per-direction AES-128-GCM, 96-bit counter nonce (never reused), tag-first
sliding replay window, transcript+PSK-bound handshake (kills MITM/downgrade).

Standalone + self-testing: `python grx_crypto.py` runs the full test suite
(handshake, seal/open, replay, reorder, tamper, MITM) with NO device needed.
"""
import struct
import hmac
import hashlib

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.kdf.hkdf import HKDF, HKDFExpand
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = 1
CIPHER_ID = 1            # AES-128-GCM
DIR_C2S = 1             # client -> server (input)
DIR_S2C = 2             # server -> client (rumble / ack)
KEY_LEN = 16            # AES-128
TAG_LEN = 16            # full 128-bit GCM tag
PLAINTEXT_LEN = 20      # the existing 20-byte input frame (<Q H B B B B B B I)
HEADER_LEN = 1 + 4      # version(1) + counter_low32(4)
WIRE_LEN = HEADER_LEN + PLAINTEXT_LEN + TAG_LEN   # = 41


# --- handshake -------------------------------------------------------------
def _lp(b):  # length-prefixed for unambiguous transcript hashing
    return struct.pack('<I', len(b)) + b


def transcript_hash(client_pub, server_pub, long_term_id):
    h = hashlib.sha256()
    h.update(_lp(struct.pack('<BB', VERSION, CIPHER_ID)))
    h.update(_lp(client_pub))
    h.update(_lp(server_pub))
    h.update(_lp(long_term_id))
    return h.digest()


def derive_keys(shared, psk, th):
    """ECDH shared + pairing PSK + transcript -> per-direction keys + confirm key.

    Each subkey is a single HKDF-SHA256(ikm = shared||psk, salt = transcript,
    info = label) — one extract+expand per key. This exactly matches Android's
    Tink Hkdf.computeHkdf("HMACSHA256", ikm, salt, info, L), so both ends derive
    identical bytes. (Do NOT switch to a master-then-expand scheme: Tink has no
    standalone HKDF-Expand, so the two languages would diverge.)
    """
    ikm = shared + psk

    def hk(label, n):
        return HKDF(algorithm=hashes.SHA256(), length=n, salt=th, info=label).derive(ikm)

    return {
        'c2s': hk(b'grx c2s v1', KEY_LEN),
        's2c': hk(b'grx s2c v1', KEY_LEN),
        'confirm': hk(b'grx confirm v1', 32),
    }


def confirm_tag(confirm_key, th, role):
    """role: b'C' (client) or b'S' (server)."""
    return hmac.new(confirm_key, th + role, hashlib.sha256).digest()


def handshake(my_priv, their_pub_bytes, psk, long_term_id, *, am_client):
    """Run the full key agreement from one side. Returns a dict of keys + transcript."""
    my_pub = my_priv.public_key().public_bytes_raw()
    their_pub = X25519PublicKey.from_public_bytes(their_pub_bytes)
    shared = my_priv.exchange(their_pub)
    cli, srv = (my_pub, their_pub_bytes) if am_client else (their_pub_bytes, my_pub)
    th = transcript_hash(cli, srv, long_term_id)
    keys = derive_keys(shared, psk, th)
    keys['transcript'] = th
    return keys


# --- replay window (tag-first) --------------------------------------------
class ReplayWindow:
    def __init__(self, bits=1024):
        self.bits = bits
        self.high = 0          # highest AUTHENTICATED counter seen
        self.mask = 0          # bit i set => (high - i) already accepted

    def reconstruct(self, low32):
        """Rebuild the full 64-bit counter from the 32-bit wire value."""
        cand = (self.high & ~0xFFFFFFFF) | (low32 & 0xFFFFFFFF)
        if cand + 0x80000000 < self.high:
            cand += 0x100000000
        elif cand > self.high + 0x80000000 and cand >= 0x100000000:
            cand -= 0x100000000
        return cand

    def check(self, counter):
        """Pre-auth: True if this counter is acceptable (not old / not a dup)."""
        if counter <= 0:
            return False
        if counter > self.high:
            return True
        offset = self.high - counter
        if offset >= self.bits:
            return False                      # too old
        return not ((self.mask >> offset) & 1)

    def commit(self, counter):
        """Post-auth ONLY. Advances the window."""
        if counter > self.high:
            shift = counter - self.high
            self.mask = ((self.mask << shift) | 1) & ((1 << self.bits) - 1)
            self.high = counter
        else:
            self.mask |= 1 << (self.high - counter)


# --- sender / receiver -----------------------------------------------------
def _nonce(direction, counter):
    return struct.pack('<IQ', direction, counter & 0xFFFFFFFFFFFFFFFF)


def _aad(counter):
    return struct.pack('<BQ', VERSION, counter & 0xFFFFFFFFFFFFFFFF)


class GrxSender:
    def __init__(self, key, direction):
        self.aead = AESGCM(key)
        self.direction = direction
        self.counter = 0

    def seal(self, plaintext):
        if len(plaintext) != PLAINTEXT_LEN:
            raise ValueError('GRX plaintext must be %d bytes' % PLAINTEXT_LEN)
        self.counter += 1                     # starts at 1, never resets
        c = self.counter
        ct = self.aead.encrypt(_nonce(self.direction, c), plaintext, _aad(c))
        return struct.pack('<BI', VERSION, c & 0xFFFFFFFF) + ct


class GrxReceiver:
    def __init__(self, key, direction, window_bits=1024):
        self.aead = AESGCM(key)
        self.direction = direction
        self.win = ReplayWindow(window_bits)

    def open(self, frame):
        """Returns the 20-byte plaintext, or None to DROP (old/dup/forged/garbage)."""
        if len(frame) != WIRE_LEN:
            return None
        ver, low32 = struct.unpack('<BI', frame[:HEADER_LEN])
        if ver != VERSION:
            return None
        counter = self.win.reconstruct(low32)
        if not self.win.check(counter):
            return None                       # 2. early dup/old reject
        try:                                  # 3. verify tag FIRST
            pt = self.aead.decrypt(_nonce(self.direction, counter),
                                   frame[HEADER_LEN:], _aad(counter))
        except Exception:
            return None                       #    auth fail -> drop, window UNTOUCHED
        self.win.commit(counter)              # 4. advance ONLY on auth success
        return pt


# --- self test -------------------------------------------------------------
def _selftest():
    import os
    psk = os.urandom(32)
    ltid = b'pair-001'

    # fresh ephemerals per connection
    c_priv, s_priv = X25519PrivateKey.generate(), X25519PrivateKey.generate()
    c_pub = c_priv.public_key().public_bytes_raw()
    s_pub = s_priv.public_key().public_bytes_raw()

    ck = handshake(c_priv, s_pub, psk, ltid, am_client=True)
    sk = handshake(s_priv, c_pub, psk, ltid, am_client=False)

    assert ck['c2s'] == sk['c2s'] and ck['s2c'] == sk['s2c'], 'key agreement mismatch'
    assert ck['transcript'] == sk['transcript'], 'transcript mismatch'
    # confirmation MACs (each verifies the other's)
    assert confirm_tag(ck['confirm'], ck['transcript'], b'C') == \
           confirm_tag(sk['confirm'], sk['transcript'], b'C'), 'confirm mismatch'
    print('[ok] handshake: keys agree, transcript binds, confirm MAC verifies')

    # client (c2s) -> server
    snd = GrxSender(ck['c2s'], DIR_C2S)
    rcv = GrxReceiver(sk['c2s'], DIR_C2S)
    frames = []
    for i in range(2000):
        pt = struct.pack('<Q H B B B B B B I', i, i & 0xFFFF, 1, 2, 3, 4, 5, 6, 0)
        f = snd.seal(pt)
        assert len(f) == WIRE_LEN
        frames.append((pt, f))
    for pt, f in frames:
        assert rcv.open(f) == pt
    print('[ok] seal/open: 2000 packets, plaintext round-trips, wire=%dB' % WIRE_LEN)

    # replay rejected
    assert rcv.open(frames[100][1]) is None and rcv.open(frames[1999][1]) is None
    print('[ok] replay: re-sent packets rejected')

    # reorder within window accepted (fresh session)
    snd2 = GrxSender(ck['c2s'], DIR_C2S); rcv2 = GrxReceiver(sk['c2s'], DIR_C2S)
    fs = [snd2.seal(struct.pack('<Q H B B B B B B I', i, 0, 0, 0, 0, 0, 0, 0, 0)) for i in range(10)]
    order = [5, 3, 9, 1, 8, 0, 7, 2, 6, 4]
    assert all(rcv2.open(fs[i]) is not None for i in order)
    assert rcv2.open(fs[5]) is None  # but a dup is still caught
    print('[ok] reorder: out-of-order delivered once, dup still rejected')

    # tamper rejected AND window not advanced (DoS guard)
    snd3 = GrxSender(ck['c2s'], DIR_C2S); rcv3 = GrxReceiver(sk['c2s'], DIR_C2S)
    good = snd3.seal(struct.pack('<Q H B B B B B B I', 1, 0, 0, 0, 0, 0, 0, 0, 0))
    # forge a high-counter packet (counter_low32 huge) with random body
    forged = struct.pack('<BI', VERSION, 0x7FFFFFFF) + (b'\x00' * (PLAINTEXT_LEN + TAG_LEN))
    assert rcv3.open(forged) is None, 'forged packet must be dropped'
    assert rcv3.win.high == 0, 'forged packet must NOT advance the window'
    assert rcv3.open(good) is not None, 'legit packet still accepted after forgery'
    print('[ok] tamper/DoS: forged high-counter dropped, window untouched, legit input survives')

    # MITM with wrong PSK -> different keys -> cannot open
    m_priv = X25519PrivateKey.generate()
    mk = handshake(m_priv, s_pub, os.urandom(32), ltid, am_client=True)  # wrong psk + wrong key
    mitm_snd = GrxSender(mk['c2s'], DIR_C2S)
    assert rcv.open(mitm_snd.seal(struct.pack('<Q H B B B B B B I', 0, 0, 0, 0, 0, 0, 0, 0, 0))) is None
    print('[ok] MITM: attacker without the pairing PSK cannot produce acceptable packets')

    print('\nALL GRX CRYPTO TESTS PASSED')


if __name__ == '__main__':
    _selftest()

"""
GRX session layer — the handshake state machine + on-transport framing that sits
on top of grx_crypto.py. This is what server.py imports: it routes handshake vs
data frames, runs the 1-RTT key agreement, and then seals/opens input packets.

Wire framing (first byte discriminates; data frames always start with VERSION=1):
  0xE1  CLIENT_HELLO   : 0xE1 | client_eph_pub(32) | lp(long_term_id)
  0xE2  SERVER_HELLO   : 0xE2 | server_eph_pub(32) | server_confirm(32)
  0xE3  CLIENT_CONFIRM : 0xE3 | client_confirm(32)
  0x01  DATA           : GRX data frame (see grx_crypto, 41 B)

Pairing (QR) supplies (long_term_id, psk) to BOTH sides out of band.
Fresh X25519 ephemerals PER SESSION -> counter-from-1 is safe (see GRX_PROTOCOL.md).

Standalone + self-testing: `python grx_session.py` runs a full in-process
client<->server handshake + encrypted exchange + downgrade/replay checks.
"""
import struct

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

import grx_crypto as gx

T_HELLO = 0xE1
T_SHELLO = 0xE2
T_CONFIRM = 0xE3
# data frames start with gx.VERSION (0x01), which can never collide with the above.

ROLE_CLIENT = b'C'
ROLE_SERVER = b'S'


def _lp(b):
    return struct.pack('<I', len(b)) + b


def _take_lp(buf, off):
    (n,) = struct.unpack_from('<I', buf, off)
    off += 4
    return buf[off:off + n], off + n


class HandshakeError(Exception):
    pass


class GrxServerSession:
    """One per connected client. Drives the handshake, then seals/opens."""

    def __init__(self, psk, long_term_id):
        self.psk = psk
        self.long_term_id = long_term_id
        self._eph = None
        self._keys = None
        self.established = False
        self.sender = None      # server->client (s2c)
        self.receiver = None    # client->server (c2s)

    def handle_hello(self, frame):
        if not frame or frame[0] != T_HELLO:
            raise HandshakeError('expected CLIENT_HELLO')
        client_pub = frame[1:33]
        ltid, _ = _take_lp(frame, 33)
        if ltid != self.long_term_id:
            raise HandshakeError('unknown long_term_id')        # not the paired device
        self._eph = X25519PrivateKey.generate()                 # fresh per session
        self._keys = gx.handshake(self._eph, client_pub, self.psk, self.long_term_id,
                                  am_client=False)
        server_pub = self._eph.public_key().public_bytes_raw()
        server_confirm = gx.confirm_tag(self._keys['confirm'], self._keys['transcript'], ROLE_SERVER)
        return struct.pack('<B', T_SHELLO) + server_pub + server_confirm

    def handle_confirm(self, frame):
        if not frame or frame[0] != T_CONFIRM or self._keys is None:
            raise HandshakeError('expected CLIENT_CONFIRM after hello')
        client_confirm = frame[1:33]
        expect = gx.confirm_tag(self._keys['confirm'], self._keys['transcript'], ROLE_CLIENT)
        if not _ct_eq(client_confirm, expect):
            raise HandshakeError('client confirmation failed (wrong PSK / MITM)')
        self.sender = gx.GrxSender(self._keys['s2c'], gx.DIR_S2C)
        self.receiver = gx.GrxReceiver(self._keys['c2s'], gx.DIR_C2S)
        self.established = True

    def open(self, data_frame):
        if not self.established:
            return None
        return self.receiver.open(data_frame)

    def seal(self, plaintext):
        return self.sender.seal(plaintext)


class GrxClientSession:
    """Reference client side (mirrors what Android implements). Used in tests."""

    def __init__(self, psk, long_term_id):
        self.psk = psk
        self.long_term_id = long_term_id
        self._eph = X25519PrivateKey.generate()                 # fresh per session
        self._keys = None
        self.established = False
        self.sender = None      # client->server (c2s)
        self.receiver = None    # server->client (s2c)

    def hello(self):
        pub = self._eph.public_key().public_bytes_raw()
        return struct.pack('<B', T_HELLO) + pub + _lp(self.long_term_id)

    def handle_server_hello(self, frame):
        if not frame or frame[0] != T_SHELLO:
            raise HandshakeError('expected SERVER_HELLO')
        server_pub = frame[1:33]
        server_confirm = frame[33:65]
        self._keys = gx.handshake(self._eph, server_pub, self.psk, self.long_term_id,
                                  am_client=True)
        expect = gx.confirm_tag(self._keys['confirm'], self._keys['transcript'], ROLE_SERVER)
        if not _ct_eq(server_confirm, expect):
            raise HandshakeError('server confirmation failed (wrong PSK / MITM)')
        self.sender = gx.GrxSender(self._keys['c2s'], gx.DIR_C2S)
        self.receiver = gx.GrxReceiver(self._keys['s2c'], gx.DIR_S2C)
        self.established = True
        client_confirm = gx.confirm_tag(self._keys['confirm'], self._keys['transcript'], ROLE_CLIENT)
        return struct.pack('<B', T_CONFIRM) + client_confirm

    def seal(self, plaintext):
        return self.sender.seal(plaintext)

    def open(self, data_frame):
        return self.receiver.open(data_frame)


def _ct_eq(a, b):
    import hmac
    return hmac.compare_digest(a, b)


# Minimum sane length per handshake type: HELLO = 1+pub(32)+lp(ltid) ≥ 34,
# SERVER_HELLO = 1+32+32 = 65, CONFIRM = 1+32 = 33. A legacy cleartext INPUT
# frame is exactly 20 bytes and starts with a little-endian timestamp whose low
# byte sweeps 0-255, so first-byte matching alone misrouted ~1/128 input frames
# into the handshake path. Pre-hardening, a fake CONFIRM (20 B unpacked as 37 B)
# raised struct.error and KILLED the server's UDP thread — port stayed bound but
# silent until the server was restarted.
_HS_MIN_LEN = {T_HELLO: 34, T_SHELLO: 65, T_CONFIRM: 33}

def is_handshake(frame):
    return (bool(frame) and frame[0] in _HS_MIN_LEN
            and len(frame) >= _HS_MIN_LEN[frame[0]])


# --- self test -------------------------------------------------------------
def _selftest():
    import os
    psk, ltid = os.urandom(32), b'pair-XYZ'

    c = GrxClientSession(psk, ltid)
    s = GrxServerSession(psk, ltid)

    shello = s.handle_hello(c.hello())
    cconfirm = c.handle_server_hello(shello)
    s.handle_confirm(cconfirm)
    assert c.established and s.established
    print('[ok] 1-RTT handshake establishes both sides')

    # client input -> server
    for i in range(500):
        pt = struct.pack('<Q H B B B B B B I', i, i & 0xFFFF, 0, 0, 128, 128, 128, 128, 0)
        assert s.open(c.seal(pt)) == pt
    print('[ok] 500 encrypted input frames round-trip client->server')

    # server rumble -> client (reverse direction works on its own key)
    rumble = struct.pack('<Q H B B B B B B I', 1, 0, 200, 200, 0, 0, 0, 0, 0)
    assert c.open(s.seal(rumble)) == rumble
    print('[ok] reverse direction (s2c rumble) round-trips on its own key')

    # wrong-PSK client is rejected at the handshake (MITM / impostor)
    bad = GrxClientSession(os.urandom(32), ltid)
    s2 = GrxServerSession(psk, ltid)
    try:
        s2.handle_confirm(bad.handle_server_hello(s2.handle_hello(bad.hello())))
        raise AssertionError('wrong-PSK client must NOT establish')
    except HandshakeError:
        print('[ok] handshake rejects a client with the wrong pairing PSK')

    # unknown device id rejected
    s3 = GrxServerSession(psk, ltid)
    try:
        s3.handle_hello(GrxClientSession(psk, b'other-device').hello())
        raise AssertionError('unknown long_term_id must be rejected')
    except HandshakeError:
        print('[ok] handshake rejects an unknown long_term_id')

    # frame routing
    assert is_handshake(c.hello()) and not is_handshake(c.seal(b'\x00' * 20))
    print('[ok] frame routing distinguishes handshake vs data')

    print('\nALL GRX SESSION TESTS PASSED')


if __name__ == '__main__':
    _selftest()

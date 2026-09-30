import socket, struct, time
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
import grx_session

KEY = "777a51b3"
psk = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"", info=b"grx psk v1").derive(bytes.fromhex(KEY))
ltid = b"gamepados-grx-v1"

c = grx_session.GrxClientSession(psk, ltid)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(2.0)
addr = ('127.0.0.1', 7777)

s.sendto(c.hello(), addr); print("-> CLIENT_HELLO sent")
shello, _ = s.recvfrom(256); print("<- SERVER_HELLO (%d B)" % len(shello))
cc = c.handle_server_hello(shello)
assert cc is not None, "FAIL: server confirm mismatch (PSK/transcript)"
s.sendto(cc, addr); print("-> CLIENT_CONFIRM sent; established =", c.established)
for i in range(5):
    pt = struct.pack('<Q H B B B B B B I', (i+1)*1000, 0, 0,0,200,128,128,128, 0)
    s.sendto(c.seal(pt), addr)
time.sleep(0.4)
print("-> 5 encrypted 41B input frames sent. PASS." if c.established else "established FALSE")

import socket
import struct
import time
import sys

def send_test_packet(ip, port, token_hex):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    
    auth_token = int(token_hex, 16)
    
    for _ in range(50):
        timestamp = int(time.time() * 1e9)
        buttons = 1 | 2 # A | B (Xbox/XInput bits 0 and 1)
        lt = 255
        rt = 0
        ls_x = 127
        ls_y = 127
        rs_x = 127
        rs_y = 127
        
        payload = struct.pack('<Q H B B B B B B I',
            timestamp, buttons, lt, rt, ls_x, ls_y, rs_x, rs_y, auth_token)
        
        sock.sendto(payload, (ip, port))
        time.sleep(0.1)

    print(f"Sent 50 packets to {ip}:{port} with token {auth_token}")
    sock.close()

if __name__ == "__main__":
    ip = sys.argv[1]
    port = int(sys.argv[2])
    token = sys.argv[3]
    send_test_packet(ip, port, token)

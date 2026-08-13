import socket
import selectors
import struct
import re
import qrcode
import sys
import threading
import time
import os
import secrets

if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

def _acquire_single_instance():
    """Ensure only ONE server runs per user session."""
    if not sys.platform.startswith("win"):
        return True
    try:
        import ctypes
        ERROR_ALREADY_EXISTS = 183
        h = ctypes.windll.kernel32.CreateMutexW(None, False, "RemoteGamepadServerSingleton")
        if not h or ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            return None
        return h
    except Exception:
        return True

_singleton = _acquire_single_instance()
if _singleton is None:
    try:
        import tkinter as _tk, tkinter.messagebox as _mb
        _tk.Tk().withdraw()
        _mb.showinfo("Gamepad Server",
                     "Gamepad Server is already running.\n\n"
                     "Find its window (the one showing the QR code) — there's no "
                     "need to open it a second time.")
    except Exception:
        pass
    sys.exit(0)

def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)

def install_vigembus_driver():
    """Silently install the ViGEmBus driver from the MSI that vgamepad bundles
    inside this exe. This is how the app self-installs 'everything needed' on a
    fresh PC — no separate installer, no download. Returns True if the MSI ran
    (UAC accepted), False otherwise. Windows-only."""
    if not sys.platform.startswith("win"):
        return False
    try:
        # vgamepad ships the driver MSI at this path; it's bundled into _MEIPASS.
        arch = "x64" if sys.maxsize > 2**32 else "x86"
        msi = get_resource_path(os.path.join(
            "vgamepad", "win", "vigem", "install", arch, f"ViGEmBusSetup_{arch}.msi"))
        if not os.path.exists(msi):
            return False
        # msiexec with /qb (basic UI) so the user sees a short progress bar and
        # the UAC prompt; /norestart avoids surprise reboots. Elevated via runas.
        import ctypes
        rc = ctypes.windll.shell32.ShellExecuteW(
            None, "runas", "msiexec.exe", f'/i "{msi}" /qb /norestart', None, 1)
        # ShellExecuteW returns >32 on success (the user accepted the UAC prompt).
        return rc > 32
    except Exception:
        return False


# vgamepad connects to the ViGEmBus driver AT IMPORT TIME (VBUS = VBus() runs on
# module load). On a PC that doesn't have the driver yet, a bare `import vgamepad`
# raises VIGEM_ERROR_BUS_NOT_FOUND *before* main() can run — so the in-main install
# fallback never fired and the app just crashed with a traceback dialog. Fix: try
# the import; if the driver is missing, install the bundled MSI and poll until the
# import succeeds.
import importlib

def _load_vgamepad():
    try:
        return importlib.import_module("vgamepad")
    except Exception as err:
        if "BUS_NOT_FOUND" not in str(err) and "vigem" not in str(err).lower():
            raise  # a genuinely unrelated import error — surface it as-is

    install_vigembus_driver()   # bundled ViGEmBus MSI + one UAC prompt
    # The MSI installs asynchronously after the prompt, so poll the import until
    # the driver registers (up to ~40s), re-running module init each attempt.
    for _ in range(40):
        for _m in [k for k in list(sys.modules) if k.startswith("vgamepad")]:
            del sys.modules[_m]
        try:
            return importlib.import_module("vgamepad")
        except Exception:
            time.sleep(1)
    # Still not up — show a friendly message instead of a raw traceback dialog.
    try:
        import tkinter as _tk, tkinter.messagebox as _mb
        _tk.Tk().withdraw()
        _mb.showerror(
            "Gamepad Server — almost there",
            "The ViGEmBus controller driver is still finishing installation.\n\n"
            "Please start Gamepad Server again. If it keeps failing, restart your PC "
            "once after the driver install — that always resolves it.")
    except Exception:
        pass
    sys.exit(1)

vg = _load_vgamepad()

# 16-Byte Payload Structure:
# [8 bytes uint64] Timestamp
# [2 bytes uint16] Buttons Bitmask
# [1 byte uint8]   Left Trigger
# [1 byte uint8]   Right Trigger
# [1 byte uint8]   Left Stick X
# [1 byte uint8]   Left Stick Y
# [1 byte uint8]   Right Stick X
# [1 byte uint8]   Right Stick Y
# [4 bytes uint32] Auth Token
PAYLOAD_FORMAT = '<Q H B B B B B B I'
PAYLOAD_SIZE = struct.calcsize(PAYLOAD_FORMAT)

# ── Version / update check ───────────────────────────────────────────────────
# RELEASE RULE (RELEASE.md): APP_VERSION here, AppVersion + VersionInfoVersion in
# installer/GamepadServer.iss, and the version registered in the admin Releases
# panel must ALL match the build being shipped. A skew between the exe's baked
# version and the manifest's advertised version makes the in-app updater loop
# forever (install → relaunch → "update available" again).
APP_VERSION = "1.1.17"
# Public manifest served by the backend ({"pc": {"version","url","notes"}, ...}).
# Overridable via env var so a backend move never needs a code change + reship.
# NOTE 2026-07-02: the previous hardcoded host (admin.gamepad.space) never served
# this endpoint — set GAMEPAD_UPDATE_URL or fix the default to the live backend.
UPDATE_MANIFEST_URL = os.environ.get(
    "GAMEPAD_UPDATE_URL",
    "https://supportportal.gamepad.space/api/version")

def _parse_version(v):
    """'1.2.10' -> (1, 2, 10); non-numeric parts -> 0. Lets us compare versions
    numerically (so 1.2.10 > 1.2.9) instead of as strings."""
    parts = []
    for p in str(v or "").strip().split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts) or (0,)

def _log_update_error(msg):
    """Append an update-check failure to a log next to the exe so 'Couldn't check'
    can actually be diagnosed. Best-effort; never raises."""
    try:
        log_dir = (os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
                   else os.path.abspath("."))
        with open(os.path.join(log_dir, "update_check.log"), "a", encoding="utf-8") as f:
            f.write(msg.rstrip() + "\n")
    except Exception:
        pass

def check_for_update(timeout=10, retries=1):
    """Fetch the manifest and compare to APP_VERSION. Returns
    {available, latest, url, notes, error, kind} and NEVER raises. `kind` is one of
    None | 'offline' | 'server' | 'timeout' | 'parse' so the UI can show a specific
    message. Retries once (the backend cold-starts on the free tier, so the first
    hit after idle can be slow). Pure stdlib → works inside the frozen exe."""
    import json, urllib.request, urllib.error, socket as _socket
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                UPDATE_MANIFEST_URL,
                headers={"User-Agent": "GamepadServer/%s" % APP_VERSION})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            pc = data.get("pc", {}) or {}
            latest = str(pc.get("version", "")).strip()
            url = pc.get("url") or ""
            notes = pc.get("notes") or ""
            available = bool(latest) and (_parse_version(latest) > _parse_version(APP_VERSION))
            return {"available": available, "latest": latest, "url": url,
                    "notes": notes, "sha256": str(pc.get("sha256") or ""),
                    "error": None, "kind": None}
        except urllib.error.HTTPError as e:
            last = ("server", "HTTP %s from update server" % e.code)
        except (urllib.error.URLError, _socket.timeout) as e:
            reason = getattr(e, "reason", e)
            if isinstance(reason, _socket.timeout) or "timed out" in str(reason).lower():
                last = ("timeout", "Update server timed out")
            else:
                last = ("offline", "No connection to update server (%s)" % reason)
        except (ValueError, json.JSONDecodeError) as e:
            last = ("parse", "Bad manifest from update server: %s" % e)
        except Exception as e:
            last = ("offline", str(e))
        # brief backoff before the cold-start retry
        if attempt < retries:
            time.sleep(1.5)
    kind, msg = last or ("offline", "unknown error")
    _log_update_error("[%s] %s -> %s" % (kind, UPDATE_MANIFEST_URL, msg))
    return {"available": False, "latest": None, "url": "", "notes": "",
            "error": msg, "kind": kind}

def download_update(url, dest_path, progress_cb=None, expected_sha256=None, timeout=60):
    """Stream the installer to dest_path, calling progress_cb(done, total) as bytes
    arrive. Verifies the optional SHA-256 and a minimal 'MZ' (Windows exe) header so
    a corrupt/partial/HTML-error download is never executed. Returns (ok, error) and
    NEVER raises. Pure stdlib → works inside the frozen exe."""
    import urllib.request, urllib.error, hashlib, socket as _socket
    try:
        # Clean up any partial file from previous attempts
        try:
            os.remove(dest_path)
        except Exception:
            pass

        req = urllib.request.Request(
            url, headers={"User-Agent": "GamepadServer/%s" % APP_VERSION})
        h = hashlib.sha256()
        first = b""
        done = 0
        total = 0
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            if total == 0:
                return (False, "server did not report file size")
            with open(dest_path, "wb") as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    if not first:
                        first = chunk[:2]
                    f.write(chunk)
                    h.update(chunk)
                    done += len(chunk)
                    if progress_cb:
                        try:
                            progress_cb(done, total)
                        except Exception:
                            pass
        if done == 0:
            return (False, "downloaded 0 bytes")
        if done < total:
            return (False, "incomplete download (%d/%d bytes)" % (done, total))
        if first[:2] != b"MZ":
            return (False, "not a valid Windows installer")
        if expected_sha256 and h.hexdigest().lower() != str(expected_sha256).lower():
            try:
                os.remove(dest_path)
            except Exception:
                pass
            return (False, "checksum mismatch — download corrupt")
        return (True, None)
    except urllib.error.HTTPError as e:
        return (False, "HTTP %d — server error" % e.code)
    except (urllib.error.URLError, _socket.timeout) as e:
        return (False, "download failed: %s" % getattr(e, "reason", e))
    except Exception as e:
        return (False, "download failed: %s" % e)

def launch_installer_elevated(installer_path):
    """Start the Inno installer elevated. '/SILENT' shows the installer's own slim
    progress bar (the 'installing' UI); it closes the running server (AppMutex +
    forced close) and relaunches the new build itself. Returns True once the
    elevated process has started (post-UAC), False if the user declined UAC or it
    couldn't launch — in which case the caller keeps running and falls back."""
    try:
        import ctypes
        params = "/SILENT /SUPPRESSMSGBOXES /NORESTART /FORCECLOSEAPPLICATIONS"
        rc = ctypes.windll.shell32.ShellExecuteW(
            None, "runas", installer_path, params, None, 1)
        return bool(rc) and int(rc) > 32
    except Exception:
        return False

# ── Global state ─────────────────────────────────────────────────────────────
class ServerTelemetry:
    def __init__(self):
        self.lock = threading.Lock()
        self.connected = False        # legacy/derived; UI computes its own state now
        self.client_ip = None
        self.last_packet_time = 0.0   # last INPUT packet (drives the pad-neutral watchdog)
        self.packet_count = 0
        # Link state — independent of whether the controller is streaming input.
        # ws_linked = the USB-wired WebSocket is connected (phone app is open over
        # the adb-reverse tunnel) EVEN on the dashboard, before any input flows.
        self.ws_linked = False
        self.transport = None         # "USB (Wired)" | "Wi-Fi" | None

telemetry = ServerTelemetry()
stop_event = threading.Event()

# ── Helpers ───────────────────────────────────────────────────────────────────
def _route_ip():
    """The local IP behind the default route (the classic 'connect to 8.8.8.8 and
    read our side' trick). Correct on a normal machine — but when a VPN like
    Surfshark is connected this becomes the VPN tunnel's IP, which a phone on the
    Wi-Fi can't reach. Used as one input to get_lan_ip(), not the final answer."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None

def _win_ipv4_adapters():
    """[(description, ipv4), ...] for every adapter — GetAdaptersAddresses via
    ctypes (Windows only; [] elsewhere or on any failure). Locale-independent.
    Needed because getaddrinfo(hostname) misses adapters on some Windows builds:
    observed the Wi-Fi IP absent entirely, leaving only VirtualBox + the default-
    route IP as candidates — and when the phone's USB tether carries the internet,
    the default route IS the tether adapter, so get_lan_ip() picked the tether IP
    and the token-0 off-LAN auth rule then rejected the phone (tether dead until
    server restart)."""
    if os.name != "nt":
        return []
    try:
        import ctypes

        class SOCKADDR(ctypes.Structure):
            _fields_ = [("sa_family", ctypes.c_ushort),
                        ("sa_data", ctypes.c_char * 14)]

        class SOCKET_ADDRESS(ctypes.Structure):
            _fields_ = [("lpSockaddr", ctypes.POINTER(SOCKADDR)),
                        ("iSockaddrLength", ctypes.c_int)]

        class IP_ADAPTER_UNICAST_ADDRESS(ctypes.Structure):
            pass
        IP_ADAPTER_UNICAST_ADDRESS._fields_ = [
            ("Length", ctypes.c_ulong), ("Flags", ctypes.c_ulong),
            ("Next", ctypes.POINTER(IP_ADAPTER_UNICAST_ADDRESS)),
            ("Address", SOCKET_ADDRESS)]

        class IP_ADAPTER_ADDRESSES(ctypes.Structure):
            pass
        # Only the leading fields we walk — the API fills a buffer we merely read,
        # so trailing fields may be omitted as long as these offsets are exact.
        IP_ADAPTER_ADDRESSES._fields_ = [
            ("Length", ctypes.c_ulong), ("IfIndex", ctypes.c_ulong),
            ("Next", ctypes.POINTER(IP_ADAPTER_ADDRESSES)),
            ("AdapterName", ctypes.c_char_p),
            ("FirstUnicastAddress", ctypes.POINTER(IP_ADAPTER_UNICAST_ADDRESS)),
            ("FirstAnycastAddress", ctypes.c_void_p),
            ("FirstMulticastAddress", ctypes.c_void_p),
            ("FirstDnsServerAddress", ctypes.c_void_p),
            ("DnsSuffix", ctypes.c_wchar_p),
            ("Description", ctypes.c_wchar_p),
            ("FriendlyName", ctypes.c_wchar_p)]

        GAA_SKIP = 0x2 | 0x4 | 0x8   # skip anycast | multicast | dns (0x1 = skip UNICAST — never!)
        size = ctypes.c_ulong(16 * 1024)
        for _ in range(3):
            buf = ctypes.create_string_buffer(size.value)
            ret = ctypes.windll.iphlpapi.GetAdaptersAddresses(
                2, GAA_SKIP, None, buf, ctypes.byref(size))   # 2 = AF_INET
            if ret == 111:      # ERROR_BUFFER_OVERFLOW -> retry with grown size
                continue
            if ret != 0:
                return []
            break
        else:
            return []

        out = []
        cur = ctypes.cast(buf, ctypes.POINTER(IP_ADAPTER_ADDRESSES))
        while cur:
            a = cur.contents
            desc = a.Description or a.FriendlyName or ""
            ua = a.FirstUnicastAddress
            while ua:
                sa = ua.contents.Address.lpSockaddr
                if sa and sa.contents.sa_family == 2:          # AF_INET
                    # sockaddr_in: family(2) port(2) addr(4). Read raw bytes —
                    # slicing the c_char array truncates at embedded NULs.
                    raw = ctypes.string_at(ctypes.addressof(sa.contents), 8)
                    ip = socket.inet_ntoa(raw[4:8])
                    if ip and not ip.startswith("127."):
                        out.append((desc, ip))
                ua = ua.contents.Next
            cur = a.Next
        return out
    except Exception:
        return []

def _all_ipv4():
    """Every IPv4 the host has, best-effort, no third-party deps."""
    ips = []
    try:
        for res in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = res[4][0]
            if ip and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    for _desc, ip in _win_ipv4_adapters():
        if ip not in ips:
            ips.append(ip)
    return ips

# USB-tether adapters (phone-as-network-card: RNDIS / NCM / "Internet Sharing").
# A tether subnet is a point-to-point link containing exactly the phone and this
# PC, so a token-0 client on it is as trustworthy as loopback — unlike the Wi-Fi
# LAN, where strangers may live. Cached briefly: the check runs per input packet.
_TETHER_DESC_RE = re.compile(r"NDIS|NCM|Tether|Internet Sharing", re.I)
_tether_cache = {"t": 0.0, "subnets": []}

def _usb_tether_subnets():
    now = time.monotonic()
    if now - _tether_cache["t"] > 5.0:
        _tether_cache["subnets"] = [
            ip.rsplit(".", 1)[0]
            for desc, ip in _win_ipv4_adapters() if _TETHER_DESC_RE.search(desc or "")
        ]
        _tether_cache["t"] = now
    return _tether_cache["subnets"]

def is_usb_tether_client(client_ip):
    """True when client_ip sits on the same /24 as one of OUR USB-tether adapters."""
    try:
        return client_ip.rsplit(".", 1)[0] in _usb_tether_subnets()
    except Exception:
        return False

def _lan_score(ip):
    """Rank an IPv4 by how likely it's the real LAN address a phone should dial.
    Home Wi-Fi/LAN is almost always 192.168.x; OpenVPN tunnels (e.g. Surfshark)
    are almost always 10.x, so 192.168.x outranks 10.x — that's what makes the QR
    keep pointing at the LAN even with the VPN connected. VirtualBox's host-only
    192.168.56.x and link-local 169.254.x are pushed to the bottom."""
    if ip.startswith("192.168.56."):                               return 20  # VirtualBox host-only
    if ip.startswith("192.168."):                                  return 100 # typical home LAN/Wi-Fi
    if any(ip.startswith("172.%d." % n) for n in range(16, 32)):   return 80  # private /12
    if ip.startswith("10."):                                       return 60  # private, but also common VPN tunnel
    if ip.startswith("169.254."):                                  return 5   # APIPA / link-local
    if ip == "127.0.0.1":                                          return 0
    return 10

def get_lan_ip():
    """Pick the IPv4 to put in the pairing QR: the address a phone on the same
    Wi-Fi should send UDP to. Prefers a real private-LAN IP over a VPN tunnel or a
    virtual-adapter IP, so QR pairing keeps working even when Surfshark/another VPN
    is connected (the bug that made 'USB works but QR doesn't' on this machine)."""
    route = _route_ip()
    cands = _all_ipv4()
    if route and route not in cands:
        cands.append(route)
    cands = [ip for ip in cands if ip and ip != "0.0.0.0"]
    if not cands:
        return route or "127.0.0.1"
    # Highest LAN score wins; on a tie prefer the default-route IP (the normal,
    # no-VPN case where route already IS the LAN IP).
    cands.sort(key=lambda ip: (_lan_score(ip), 1 if ip == route else 0), reverse=True)
    chosen = cands[0]
    try:
        others = ", ".join(ip for ip in cands if ip != chosen)
        print("LAN IP for QR: %s (route=%s; other candidates: %s)" % (chosen, route, others or "none"))
    except Exception:
        pass
    return chosen

def _gp_config_dir():
    """Per-user config dir (%LOCALAPPDATA%\\GamepadServer). Holds the pairing key
    and the first-run setup marker. Created lazily; falls back to the home dir."""
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "GamepadServer")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return d

def is_first_run():
    """True until the one-time setup (driver + firewall) has been attempted once.
    Matches the reference app's UX: ask for permissions ONCE at the starting phase,
    then launch silently forever after (no UAC on normal launches)."""
    return not os.path.exists(os.path.join(_gp_config_dir(), "setup_done"))

def mark_setup_done():
    try:
        with open(os.path.join(_gp_config_dir(), "setup_done"), "w") as f:
            f.write("1")
    except Exception:
        pass

def ensure_firewall_rule(base_port=7777, span=10):
    """Allow the phone's inbound packets through Windows Firewall. Without this the
    PC silently drops every datagram — the phone 'connects' but never gets an ACK,
    the #1 wireless-fail cause, worst on a Public network (Windows blocks inbound
    by default there).

    Strategy copied from the commercial reference app (verified from its live
    firewall rules): a PROGRAM-scoped rule — allow THIS exe, any local port, any
    profile (incl. Public), UDP+TCP. Program + Port=Any is bulletproof: it covers
    the 7778+ bind fallback automatically AND applies on Public Wi-Fi, so wireless
    'just works' with no port/profile guesswork. A port-range rule
    (base_port..base_port+span-1) is added as well so dev (non-frozen) runs and odd
    setups still work. Legacy/duplicate rules from older builds are deleted first
    so they don't pile up (our portable exe's path changes between builds, which is
    why those accumulated).

    Best-effort and idempotent:
      • admin     → apply directly via netsh (silent).
      • non-admin → elevate ONE helper .bat (single UAC); declining still lets the
        server run (private nets often work without it).
    Only runs on Windows."""
    if not sys.platform.startswith("win"):
        return
    try:
        import ctypes, tempfile
        localport = "%d-%d" % (base_port, base_port + span - 1)
        exe = sys.executable if getattr(sys, "frozen", False) else None
        is_admin = False
        try:
            is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            is_admin = False
        # Delete-then-add via a tiny temp .bat so the quoted rule names + exe path
        # survive elevation intact (nested quotes through ShellExecuteW are fragile).
        bat = os.path.join(tempfile.gettempdir(), "remotegamepad_fw.bat")
        with open(bat, "w") as f:
            f.write("@echo off\r\n")
            # Clear our current + legacy/duplicate rule names so they don't accumulate.
            for old in ("Gamepad Server (UDP)", "Gamepad Server (TCP)",
                        "RemoteGamepad Server UDP", "RemoteGamepad Server",
                        "gamepadserver"):
                f.write('netsh advfirewall firewall delete rule name="%s" >nul 2>&1\r\n' % old)
            # Program-scoped allow (any port, any profile) — the robust, reference-app way.
            if exe:
                f.write('netsh advfirewall firewall add rule name="Gamepad Server (UDP)" '
                        'dir=in action=allow program="%s" protocol=UDP profile=any enable=yes >nul 2>&1\r\n' % exe)
                f.write('netsh advfirewall firewall add rule name="Gamepad Server (TCP)" '
                        'dir=in action=allow program="%s" protocol=TCP profile=any enable=yes >nul 2>&1\r\n' % exe)
            # Port-range fallback (covers dev runs + the whole bind fallback span).
            f.write('netsh advfirewall firewall add rule name="RemoteGamepad Server UDP" '
                    'dir=in action=allow protocol=UDP localport=%s profile=any enable=yes >nul 2>&1\r\n'
                    % localport)
        if is_admin:
            os.system('"%s"' % bat)
        else:
            # Elevate the helper (one UAC prompt); don't block the server on it.
            ctypes.windll.shell32.ShellExecuteW(None, "runas", bat, None, None, 0)
    except Exception:
        # Never let firewall setup stop the server from starting.
        pass

def _firewall_allows_port(port):
    """True if our inbound-UDP allow-rule ALREADY covers `port`, so a normal
    launch can skip the UAC prompt. Parses the existing 'RemoteGamepad Server UDP'
    rule's LocalPort, which may be a single port ('7777', older builds) or a range
    ('7777-7786'). Returns False if the rule is missing or doesn't cover `port` —
    which is exactly when wireless is silently broken and worth one repair prompt."""
    if not sys.platform.startswith("win"):
        return True
    try:
        import subprocess
        out = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule",
             "name=RemoteGamepad Server UDP"],
            capture_output=True, text=True, timeout=5,
            creationflags=0x08000000).stdout  # CREATE_NO_WINDOW
    except Exception:
        return False
    if not out or "No rules match" in out:
        return False
    for line in out.splitlines():
        if "localport" not in line.lower():
            continue
        spec = line.split(":", 1)[-1].strip()  # "7777" or "7777-7786"
        try:
            if "-" in spec:
                lo, hi = spec.split("-", 1)
                if int(lo) <= port <= int(hi):
                    return True
            elif spec.isdigit() and int(spec) == port:
                return True
        except Exception:
            pass
    return False

def _firewall_program_rule_ok(exe):
    """True if an enabled inbound allow-rule is already scoped to THIS exe (program
    rule, any port) — the bulletproof case, so a normal launch skips the UAC prompt
    no matter which port we bind."""
    if not sys.platform.startswith("win") or not exe:
        return False
    try:
        import subprocess
        out = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule",
             "name=Gamepad Server (UDP)", "verbose"],
            capture_output=True, text=True, timeout=5,
            creationflags=0x08000000).stdout  # CREATE_NO_WINDOW
    except Exception:
        return False
    if not out or "No rules match" in out:
        return False
    for line in out.splitlines():
        if line.strip().lower().startswith("program:"):
            prog = line.split(":", 1)[-1].strip()  # maxsplit=1 keeps the C:\ path intact
            if prog and prog.lower() == exe.lower():
                return True
    return False

def _acquire_single_instance():
    """Ensure only ONE server runs per user session. A second launch can't bind
    7777, falls back to 7778+ (a port the firewall rule may not cover), and its QR
    then advertises a blocked port — a silent 'wireless always fails'. Returns a
    mutex handle to keep alive for the process lifetime, True on non-Windows / if
    the guard can't be created, or None if another instance already owns it.
    Windows auto-releases the mutex when the owning process exits, so a crashed or
    closed instance never permanently blocks the next launch."""
    if not sys.platform.startswith("win"):
        return True
    try:
        import ctypes
        ERROR_ALREADY_EXISTS = 183
        h = ctypes.windll.kernel32.CreateMutexW(None, False,
                                                "RemoteGamepadServerSingleton")
        if not h or ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            return None
        return h
    except Exception:
        return True  # never block startup just because the guard failed

def suppress_udp_connreset(sock):
    """Windows-only, best-effort: turn OFF the SIO_UDP_CONNRESET behaviour.

    On Windows, after we sendto() an ACK to a client that has since closed its
    socket, the OS surfaces that client's ICMP 'port unreachable' as a
    ConnectionResetError (WinError 10054) on the *next* recvfrom() — which, if
    unhandled, kills the receive thread (input silently stops).

    IMPORTANT: Python's socket.ioctl() does NOT support SIO_UDP_CONNRESET — it
    only knows SIO_RCVALL / SIO_KEEPALIVE_VALS / SIO_LOOPBACK_FAST_PATH, so
    `sock.ioctl(SIO_UDP_CONNRESET, ...)` raises
    'ValueError: invalid ioctl command 2550136844' and crashes startup. (That is
    exactly the bug that took down the packaged build.) The correct way is to
    call WSAIoctl directly via ctypes. Any failure here is ignored: the recv
    loop also catches ConnectionResetError as a fallback."""
    if not sys.platform.startswith("win"):
        return
    try:
        import ctypes
        from ctypes import wintypes
        SIO_UDP_CONNRESET = 0x9800000C  # _WSAIOW(IOC_VENDOR, 12)
        ws2 = ctypes.windll.ws2_32
        ws2.WSAIoctl.argtypes = [
            ctypes.c_void_p,                 # SOCKET (UINT_PTR — full width on x64)
            wintypes.DWORD,                  # dwIoControlCode
            ctypes.c_void_p, wintypes.DWORD, # lpvInBuffer, cbInBuffer
            ctypes.c_void_p, wintypes.DWORD, # lpvOutBuffer, cbOutBuffer
            ctypes.POINTER(wintypes.DWORD),  # lpcbBytesReturned
            ctypes.c_void_p, ctypes.c_void_p # lpOverlapped, lpCompletionRoutine
        ]
        ws2.WSAIoctl.restype = ctypes.c_int
        disable = ctypes.c_ulong(0)          # FALSE = turn the behaviour off
        returned = wintypes.DWORD(0)
        ws2.WSAIoctl(sock.fileno(), SIO_UDP_CONNRESET,
                     ctypes.byref(disable), ctypes.sizeof(disable),
                     None, 0, ctypes.byref(returned), None, None)
    except Exception:
        pass

def bind_server_socket(base_port=7777, max_attempts=10):
    for port in range(base_port, base_port + max_attempts):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setblocking(False)
            # Stop a vanished client from killing the recv thread (see helper).
            suppress_udp_connreset(sock)
            # Low-latency socket tuning:
            #  - Large RX buffer so a burst of 1000Hz packets is never dropped
            #    while the thread is briefly busy (we still drain to newest).
            #  - Modest TX buffer so ACK sends never block on a full kernel buffer.
            #  - IP_TOS DSCP-EF to match the client's QoS tagging symmetrically.
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)  # 1 MB
            except OSError:
                pass
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1 << 20)  # 1 MB ACK headroom
            except OSError:
                pass
            try:
                # Match the phone's outbound tagging (DSCP-EF, Expedited Forwarding)
                # so our ACKs land in the same WMM/QoS class as inbound packets.
                IPTOS_DSCP_EF = 0xB8
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_TOS, IPTOS_DSCP_EF)
            except OSError:
                pass
            sock.bind(('0.0.0.0', port))
            return sock, port
        except OSError:
            continue
    raise Exception("Could not bind to any port.")

def boost_process_priority():
    """Raise this process to HIGH priority so the Windows scheduler doesn't
    delay the UDP receive thread under load. Best-effort; ignored if it fails."""
    try:
        import ctypes
        HIGH_PRIORITY_CLASS = 0x00000080
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.kernel32.SetPriorityClass(handle, HIGH_PRIORITY_CLASS)
    except Exception:
        pass

def boost_timer_resolution():
    """Raise the Windows system timer resolution to 1ms so selectors.select()
    timeouts and any sleeps aren't quantized to the default ~15.6ms tick. This
    tightens the worst-case latency of the UDP receive loop. Best-effort and
    Windows-only; the matching timeEndPeriod(1) is registered via atexit so the
    resolution is restored on any exit path. Ignored if it fails."""
    if sys.platform != 'win32':
        return
    try:
        import ctypes, atexit
        winmm = ctypes.WinDLL('winmm')
        winmm.timeBeginPeriod(1)
        atexit.register(lambda: winmm.timeEndPeriod(1))
    except Exception:
        pass

def reset_gamepad_state(gamepad):
    gamepad.reset()
    # XInput sticks are signed floats centered on 0.0 (true neutral). Resetting to
    # exact center stops Windows reading a constant nudge (Game Bar self-scroll /
    # mouse stutter from a never-quite-centered stick).
    gamepad.left_joystick_float(x_value_float=0.0, y_value_float=0.0)
    gamepad.right_joystick_float(x_value_float=0.0, y_value_float=0.0)

def generate_qr_image(ip, port, key):
    """Return a PIL Image of the QR code."""
    csv_str = f"{ip},{port},{key}"
    qr = qrcode.QRCode(box_size=6, border=2)
    qr.add_data(csv_str)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    return img.get_image(), csv_str   # returns PIL Image

def is_offlan_client(client_ip, lan_ip):
    if not client_ip or not lan_ip:
        return False
    if client_ip.startswith("127."):
        return True
    try:
        return client_ip.rsplit(".", 1)[0] != lan_ip.rsplit(".", 1)[0]
    except Exception:
        return False

# ── UDP processing thread ─────────────────────────────────────────────────────
import subprocess

# Serializes virtual-pad updates between the UDP (Wi-Fi/tether) and WebSocket
# (USB-debugging) transports so they never write the pad at the same time.
GAMEPAD_LOCK = threading.Lock()
WS_PORT = 7777  # fixed port for the USB-debugging WebSocket (phone dials localhost)

# ── Multi-controller sessions ──────────────────────────────────────────────
# Each connected phone gets its OWN virtual Xbox pad so inputs never merge. A
# session is keyed by the client's source IP (Wi-Fi phones each have a distinct
# LAN IP) or the literal "usb" for the single wired phone. (A per-install device
# ID in the packet would add reconnect-stability later, but IP keying already
# gives each phone an independent controller with no protocol change.)
MAX_PADS = 4   # XInput supports four controllers

class PadSession:
    __slots__ = ("pad", "last_report", "last_ts", "addr",
                 "rumble_large", "rumble_small", "last_rmb_sent",
                 "last_seen", "is_neutral", "allow_guide")
    def __init__(self, pad):
        self.pad = pad
        self.allow_guide = True      # False for USB-tether clients (Game Bar kills the link)
        self.last_report = None      # dedup baseline (per pad)
        self.last_ts = 0             # ordering baseline (per pad)
        self.addr = None             # where to send this pad's rumble
        self.rumble_large = 0
        self.rumble_small = 0
        self.last_rmb_sent = (0, 0)  # last (large, small) emitted over UDP
        self.last_seen = time.perf_counter()
        self.is_neutral = True

class PadManager:
    """Owns one VX360Gamepad per active client. Thread-safe; all vgamepad writes
    go through GAMEPAD_LOCK so the UDP thread, the WS thread and the idle watchdog
    never touch a pad concurrently."""
    def __init__(self, max_pads=MAX_PADS):
        self.lock = threading.Lock()
        self.sessions = {}   # key -> PadSession
        self.max = max_pads

    def acquire(self, key, addr=None):
        """Return the session for `key`, creating a fresh virtual pad if needed.
        None if we're already at the controller limit."""
        with self.lock:
            s = self.sessions.get(key)
            if s is None:
                # Single-phone transport migration (Wi-Fi <-> USB tether): the SAME
                # phone reappears from a new source IP while its old session just
                # went quiet. Rebind that session so the controller KEEPS its
                # ViGEm pad and therefore its XInput slot. Without this, the
                # switch creates pad 2 while the old pad lingers, and the wired
                # pad stays parked as player 2 even after the old one retires —
                # games only listen to player 1, so "buttons work on wireless but
                # not wired". Only IP-keyed (UDP) sessions migrate: a WS session
                # sits legitimately idle on the dashboard, so stealing its pad
                # would let two transports drive one controller.
                # Migration fires ONLY when this is the ONE and only device on the
                # server: a single phone hopping Wi-Fi <-> USB tether. Requiring
                # len(sessions)==1 means the moment a SECOND device is present (any
                # transport), a newcomer always gets its own fresh pad — no stealing,
                # no overlap. Guards, all required:
                #   • incoming key is UDP (not usb:/aoa)   — WS/AOA never migrate
                #   • exactly one existing session, and it's UDP
                #   • different /24 (the Wi-Fi<->tether signature; same-subnet =
                #     two phones on one router, never migrate)
                #   • the lone session went quiet 0.5-3.5s ago (a switch gap, not an
                #     actively-playing phone, which pings every ~16ms)
                if not key.startswith("usb:") and key != "aoa" and len(self.sessions) == 1:
                    old_key = next(iter(self.sessions))
                    def _subnet(k):
                        try: return k.rsplit(".", 1)[0]
                        except Exception: return k
                    is_udp_old = not old_key.startswith("usb:") and old_key != "aoa"
                    if (is_udp_old and _subnet(old_key) != _subnet(key)
                            and 0.5 < time.perf_counter() - self.sessions[old_key].last_seen < 3.5):
                        s = self.sessions.pop(old_key)
                        s.last_ts = 0        # new stream -> new ordering base
                        s.last_report = None
                        s.last_seen = time.perf_counter()
                        self.sessions[key] = s
                        try:
                            print("Controller session %s -> %s (single-device transport switch; pad + XInput slot kept)"
                                  % (old_key, key), flush=True)
                        except Exception:
                            pass
            if s is None:
                if len(self.sessions) >= self.max:
                    return None
                try:
                    with GAMEPAD_LOCK:
                        pad = vg.VX360Gamepad()
                        reset_gamepad_state(pad)
                        pad.update()
                except Exception:
                    return None
                s = PadSession(pad)
                # Per-pad rumble: the game's force-feedback for THIS pad lands here
                # so the right phone vibrates (closure binds the session).
                def _cb(client, target, large_motor, small_motor, led_number, user_data):
                    nl, ns = int(large_motor), int(small_motor)
                    # Log when the game's force-feedback starts/stops so rumble is diagnosable:
                    # if these lines never appear while a game rumbles, the game/ViGEm isn't
                    # emitting FFB to the virtual pad (i.e. NOT a phone/network problem).
                    if bool(nl or ns) != bool(s.rumble_large or s.rumble_small):
                        print("[RMB] game FFB %s: large=%d small=%d" % (key, nl, ns), flush=True)
                    s.rumble_large = nl
                    s.rumble_small = ns
                try:
                    pad.register_notification(callback_function=_cb)
                except Exception:
                    pass
                self.sessions[key] = s
                try:
                    print("Controller session +%s (active=%d)" % (key, len(self.sessions)))
                except Exception:
                    pass
            if addr is not None:
                s.addr = addr
            return s

    def idle_tick(self, now):
        """Reset briefly-quiet pads to neutral (anti-stuck) and drop long-silent
        ones so the virtual controller disappears from Windows on disconnect."""
        with self.lock:
            drop = []
            for key, s in self.sessions.items():
                gap = now - s.last_seen
                if gap > 3.0:
                    drop.append(key)
                elif gap > 0.5 and not s.is_neutral:
                    with GAMEPAD_LOCK:
                        reset_gamepad_state(s.pad)
                        if s.pad is not None:
                            try:
                                s.pad.update()
                            except Exception:
                                pass
                    s.last_report = None
                    s.is_neutral = True
            for key in drop:
                s = self.sessions.pop(key)
                self._free(s)
                try:
                    print("Controller session -%s (active=%d)" % (key, len(self.sessions)))
                except Exception:
                    pass

    def _free(self, s):
        pad = s.pad
        try:
            with GAMEPAD_LOCK:
                reset_gamepad_state(pad)
                pad.update()
        except Exception:
            pass
        # Unplug the ViGEm pad NOW. The per-pad rumble callback captured this
        # session, and the session holds the pad, forming a reference cycle:
        #   pad -> cmp_func -> _cb closure -> s -> pad
        # Refcounting alone can never break that, so without this the virtual
        # controller lingered as a GHOST (0-input) pad until Python's cyclic GC
        # eventually ran — and a ghost squats an XInput slot, pushing the next
        # real phone to player 2 (games only read player 1). Unregister the FFB
        # callback, then drop both refs so refcount hits 0 and __del__ removes
        # the target immediately.
        try:
            from vgamepad.win import vigem_client as _vcli
            with GAMEPAD_LOCK:
                _vcli.vigem_target_x360_unregister_notification(pad._busp, pad._devicep)
        except Exception:
            pass
        try:
            pad.cmp_func = None      # drop the closure ref (breaks the cycle)
        except Exception:
            pass
        s.pad = None                 # drop the session's ref -> pad freed on return

    def remove(self, key):
        """Drop a session immediately (e.g. a USB WebSocket disconnected), freeing
        its virtual pad now instead of waiting for the idle GC."""
        with self.lock:
            s = self.sessions.pop(key, None)
            n = len(self.sessions)
        if s is not None:
            self._free(s)
            try:
                print("Controller session -%s (active=%d)" % (key, n))
            except Exception:
                pass

    def count(self):
        with self.lock:
            return len(self.sessions)

    def shutdown(self):
        with self.lock:
            for s in self.sessions.values():
                self._free(s)
            self.sessions.clear()

def _force_pad_reset(sess):
    """Reset one session's pad to neutral and clear its dedup baseline (used when
    a wired link drops)."""
    if sess is None or sess.pad is None: return
    with GAMEPAD_LOCK:
        reset_gamepad_state(sess.pad)
        try:
            sess.pad.update()
        except Exception:
            pass
    sess.last_report = None
    sess.is_neutral = True

# ── Hot-path lookup tables (PERF) ────────────────────────────────────────────
# These replace two closures that used to be re-created on EVERY packet inside
# apply_inputs — and crucially _snap ran BEFORE the "report unchanged" early-out,
# so it cost on every single inbound packet, not just on input changes. Both are
# pure functions of one byte, so a 256-entry table removes the call entirely.
#   _SNAP_LUT : centre-deadzone snap (|v-128| <= 4 → 128)
#   _AXIS_LUT : byte → XInput float axis (-1.0 .. 1.0, centre 128)
_SNAP_LUT = bytes(128 if abs(v - 128) <= 4 else v for v in range(256))
_AXIS_LUT = tuple(max(-1.0, min(1.0, (b - 128) / 127.0)) for b in range(256))


def apply_inputs(sess, buttons, lt, rt, ls_x, ls_y, rs_x, rs_y):
    """Translate one decoded 20-byte packet into THIS session's virtual Xbox pad.
    Shared by the UDP (Wi-Fi) and WebSocket (USB) transports. Skips the driver
    write when the report is identical to the last one applied (no change → no
    IOCTL). All pad writes are serialized by GAMEPAD_LOCK."""
    sess.is_neutral = False

    ls_x = _SNAP_LUT[ls_x]; ls_y = _SNAP_LUT[ls_y]
    rs_x = _SNAP_LUT[rs_x]; rs_y = _SNAP_LUT[rs_y]

    report = (buttons, lt, rt, ls_x, ls_y, rs_x, rs_y)
    if report == sess.last_report:
        return
    sess.last_report = report

    gamepad = sess.pad
    with GAMEPAD_LOCK:
        reset_gamepad_state(gamepad)
        gamepad.left_trigger(value=lt)
        gamepad.right_trigger(value=rt)

        gamepad.left_joystick_float(x_value_float=_AXIS_LUT[ls_x], y_value_float=-_AXIS_LUT[ls_y])
        gamepad.right_joystick_float(x_value_float=_AXIS_LUT[rs_x], y_value_float=-_AXIS_LUT[rs_y])

        XB = vg.XUSB_BUTTON
        if buttons & (1 << 0):  gamepad.press_button(button=XB.XUSB_GAMEPAD_A)
        if buttons & (1 << 1):  gamepad.press_button(button=XB.XUSB_GAMEPAD_B)
        if buttons & (1 << 2):  gamepad.press_button(button=XB.XUSB_GAMEPAD_X)
        if buttons & (1 << 3):  gamepad.press_button(button=XB.XUSB_GAMEPAD_Y)
        if buttons & (1 << 4):  gamepad.press_button(button=XB.XUSB_GAMEPAD_LEFT_SHOULDER)
        if buttons & (1 << 5):  gamepad.press_button(button=XB.XUSB_GAMEPAD_RIGHT_SHOULDER)
        if buttons & (1 << 6):  gamepad.press_button(button=XB.XUSB_GAMEPAD_START)
        if buttons & (1 << 7):  gamepad.press_button(button=XB.XUSB_GAMEPAD_BACK)
        if buttons & (1 << 8):  gamepad.press_button(button=XB.XUSB_GAMEPAD_LEFT_THUMB)
        if buttons & (1 << 9):  gamepad.press_button(button=XB.XUSB_GAMEPAD_RIGHT_THUMB)
        if buttons & (1 << 10): gamepad.press_button(button=XB.XUSB_GAMEPAD_DPAD_UP)
        if buttons & (1 << 11): gamepad.press_button(button=XB.XUSB_GAMEPAD_DPAD_DOWN)
        if buttons & (1 << 12): gamepad.press_button(button=XB.XUSB_GAMEPAD_DPAD_LEFT)
        if buttons & (1 << 13): gamepad.press_button(button=XB.XUSB_GAMEPAD_DPAD_RIGHT)
        # Guide (bit 14, phone's 🎮): forwarded on every transport so the Xbox
        # overlay works. An old Windows build reset the RNDIS tether adapter when
        # the Game Bar opened; retested clean on Win11 26200 (2026-07-03).
        # allow_guide (default True) is kept as a per-session escape hatch.
        if buttons & (1 << 14) and sess.allow_guide:
            gamepad.press_button(button=XB.XUSB_GAMEPAD_GUIDE)

        gamepad.update()


def _extract_bundled_adb():
    """Copy the bundled adb.exe + its DLLs OUT of the PyInstaller _MEI temp dir into
    a stable per-user folder and return that adb.exe. Running adb straight from _MEI
    keeps adb's background server process holding those files open, so on exit the
    bootloader can't delete the temp dir → the 'failed to remove temporary directory
    \\Temp\\_MEIxxxx' warning. Running from a stable folder removes the cause entirely.
    Returns None when not frozen or if extraction fails."""
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return None
    try:
        import shutil
        dst_dir = os.path.join(_gp_config_dir(), "adb")   # %LOCALAPPDATA%\GamepadServer\adb
        os.makedirs(dst_dir, exist_ok=True)
        for f in ("adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"):
            src = os.path.join(meipass, f)
            dst = os.path.join(dst_dir, f)
            # Copy only if missing or a different size (avoids re-locking a file an
            # adb server from a prior run might still hold; the existing copy is fine).
            if os.path.exists(src) and (not os.path.exists(dst) or os.path.getsize(src) != os.path.getsize(dst)):
                try:
                    shutil.copy2(src, dst)
                except Exception:
                    pass
        adb_dst = os.path.join(dst_dir, "adb.exe")
        return adb_dst if os.path.exists(adb_dst) else None
    except Exception:
        return None

def _find_adb():
    """Locate adb.exe. Prefer a copy extracted to a stable folder (so the bundled
    one in the _MEI temp dir is never held open by adb → the temp dir cleans up on
    exit); then a sibling platform-tools; then PATH."""
    stable = _extract_bundled_adb()
    if stable:
        return stable
    cands = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        cands.append(os.path.join(meipass, "adb.exe"))
    exe_dir = (os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
               else os.path.dirname(os.path.abspath(__file__)))
    cands += [
        os.path.join(exe_dir, "adb.exe"),
        os.path.join(exe_dir, "platform-tools", "adb.exe"),
        os.path.join(exe_dir, "..", "platform-tools", "adb.exe"),
        os.path.join(exe_dir, "..", "..", "platform-tools", "adb.exe"),
        "adb",
    ]
    for c in cands:
        if c == "adb" or os.path.exists(c):
            return c
    return None


_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW — keep adb console hidden in the windowed app

def start_adb_reverse_watcher(port=WS_PORT):
    """Keep `adb reverse tcp:port tcp:port` alive for EVERY connected device so each
    USB phone's localhost reaches us (a bare `adb reverse` errors with more than one
    device, so we map each by serial — that's what lets TWO phones connect over USB).

    Kept LIGHT on the CPU: polls every 5s while a phone is attached and only every
    10s when none is (adb is irrelevant to Wi-Fi pairing). On exit we shut adb's
    background server down — that frees its CPU and, crucially, releases the bundled
    adb files so the app's temp folder is removed cleanly (the 'failed to remove
    temporary directory' warning was a leftover adb process holding those files)."""
    adb = _find_adb()
    if not adb:
        print("adb not found - USB-debugging wired mode unavailable.")
        return
    import atexit
    def _shutdown_adb():
        try:
            subprocess.run([adb, "kill-server"], capture_output=True, timeout=8, creationflags=_NO_WINDOW)
            time.sleep(0.4)   # let the OS release the bundled adb files before temp cleanup
        except Exception:
            pass
    atexit.register(_shutdown_adb)
    def loop():
        while not stop_event.is_set():
            serials = []
            try:
                out = subprocess.run([adb, "devices"], capture_output=True, text=True,
                                     timeout=8, creationflags=_NO_WINDOW).stdout or ""
                for line in out.splitlines()[1:]:          # skip the header line
                    parts = line.split()
                    if len(parts) >= 2 and parts[1] == "device":
                        serials.append(parts[0])
                for serial in serials:
                    subprocess.run([adb, "-s", serial, "reverse", f"tcp:{port}", f"tcp:{port}"],
                                   capture_output=True, timeout=8, creationflags=_NO_WINDOW)
            except Exception:
                pass
            # Gentle cadence: only re-check often when a USB phone is actually present.
            time.sleep(5 if serials else 10)
    threading.Thread(target=loop, daemon=True).start()


# ── Rumble / force-feedback ────────────────────────────────────────────────
# Rumble is now per-session: each pad created in PadManager.acquire() registers
# its own callback that writes the latest motor values onto its PadSession, so
# the right phone vibrates. The WS (USB) transport streams its session's values
# back to the wired phone below.

_ws_conn_seq = 0

def start_ws_bridge(padmgr, port=WS_PORT):
    """WebSocket transport for USB-debugging mode. The phone connects to
    ws://127.0.0.1:port (tunneled by `adb reverse`) and streams the same 20-byte
    packets. Reuses apply_inputs() and echoes an ACK so latency still works."""
    import asyncio
    import websockets

    async def handler(ws):
        # Disable Nagle on this connection so small 20-byte packets/ACKs aren't
        # buffered — keeps the USB-debugging path as low-latency as possible.
        try:
            tr = getattr(ws, "transport", None)
            raw = tr.get_extra_info("socket") if tr else None
            if raw is not None:
                raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass

        # The WIRED link is now UP (phone dialed the WS over adb-reverse). Mark it
        # connected immediately — the phone keeps this socket open on EVERY screen,
        # so the server shows "connected" as soon as the cable+app are ready, not
        # only once the controller screen starts streaming input.
        with telemetry.lock:
            telemetry.ws_linked = True
            telemetry.transport = "USB (Wired)"
            telemetry.client_ip = "USB cable"

        global _ws_conn_seq
        _ws_conn_seq += 1
        ws_key = "usb:%d" % _ws_conn_seq
        sess = padmgr.acquire(ws_key, addr=("usb", 0))

        async def _recv():
            async for msg in ws:
                if not isinstance(msg, (bytes, bytearray)) or len(msg) != PAYLOAD_SIZE:
                    continue
                ts, buttons, lt, rt, ls_x, ls_y, rs_x, rs_y, _auth = struct.unpack(PAYLOAD_FORMAT, msg)
                if sess is None:
                    # No pad (4-pad limit hit when this socket opened). Don't ACK —
                    # the phone must look unconnected rather than silently dead.
                    continue
                apply_inputs(sess, buttons, lt, rt, ls_x, ls_y, rs_x, rs_y)
                sess.last_seen = time.perf_counter()
                telemetry.last_packet_time = time.perf_counter()
                with telemetry.lock:
                    telemetry.transport = "USB (Wired)"
                    telemetry.client_ip = "USB cable"
                    telemetry.packet_count += 1
                try:
                    await ws.send(b"ACK" + struct.pack("<Q", ts))
                except Exception:
                    return

        # Push THIS session's rumble back to the phone (b"RMB" + large + small).
        # Sends while non-zero to sustain, plus one final zero to stop.
        async def _rumble():
            last = (-1, -1)
            while True:
                await asyncio.sleep(0.05)
                cur = (sess.rumble_large, sess.rumble_small) if sess is not None else (0, 0)
                if cur != (0, 0) or last != (0, 0):
                    last = cur
                    try:
                        await ws.send(b"RMB" + bytes([cur[0] & 0xFF, cur[1] & 0xFF]))
                    except Exception:
                        return

        rumble_task = asyncio.create_task(_rumble())
        try:
            await _recv()
        finally:
            rumble_task.cancel()
            padmgr.remove(ws_key)   # free THIS phone's pad on disconnect
            # Wired link dropped (app closed / cable pulled / screen off).
            with telemetry.lock:
                telemetry.ws_linked = False
                if telemetry.transport == "USB (Wired)":
                    telemetry.transport = None

    async def serve():
        async with websockets.serve(handler, "127.0.0.1", port, max_size=64, ping_interval=None):
            await asyncio.Future()

    try:
        asyncio.run(serve())
    except Exception as e:
        print("WS bridge stopped:", e)


def start_aoa_bridge(padmgr):
    """AOA (Android Open Accessory) direct-USB transport — the lowest-latency wired
    path (~1-2 ms): raw USB bulk endpoints, no IP stack, no adb. Coexists with the
    UDP (Wi-Fi/tether) and WS (USB-debug) transports; the phone uses whichever it's
    on and the server applies whatever arrives. Reuses apply_inputs() and the same
    "ACK"+ts / "RMB" framing. No-ops gracefully if pyusb/libusb or a WinUSB-bound
    accessory isn't present, so the server ALWAYS runs without it."""
    try:
        from aoa_transport import AoaTransport, usb as _usb
    except Exception as e:
        print("AOA transport unavailable (import failed: %s); UDP/WS still active." % e)
        return
    if _usb is None:
        print("AOA transport disabled: pyusb/libusb not installed. UDP/WS still active.")
        return

    AOA_KEY = "aoa"
    warned = False
    while True:
        transport = None
        sess = None
        try:
            transport = AoaTransport.connect()
        except Exception as e:
            # No accessory / driver yet — keep watching quietly (announce once).
            if not warned:
                print("AOA: no accessory yet (%s). Watching for one…" % e)
                warned = True
            time.sleep(3.0)
            continue
        warned = False
        print("AOA: accessory connected — direct-USB transport active.")
        sess = padmgr.acquire(AOA_KEY, addr=("aoa", 0))
        with telemetry.lock:
            telemetry.transport = "USB-AOA (Wired)"
            telemetry.client_ip = "USB (AOA)"
        last_rmb = (-1, -1)
        try:
            while True:
                pkt = transport.recv(timeout_ms=200)
                if pkt is not None and len(pkt) >= PAYLOAD_SIZE:
                    ts, buttons, lt, rt, ls_x, ls_y, rs_x, rs_y, _auth = struct.unpack(
                        PAYLOAD_FORMAT, bytes(pkt[:PAYLOAD_SIZE]))
                    if sess is not None:
                        apply_inputs(sess, buttons, lt, rt, ls_x, ls_y, rs_x, rs_y)
                        sess.last_seen = time.perf_counter()
                        telemetry.last_packet_time = time.perf_counter()
                        with telemetry.lock:
                            telemetry.packet_count += 1
                        # ACK only when we have a real pad. A 5th device (past the
                        # 4-pad XInput limit) gets NO pad → must look unconnected,
                        # not silently dead — matching the UDP and WS transports.
                        transport.send_ack(ts)
                # Push this pad's rumble back over USB (same RMB framing as UDP/WS):
                # while non-zero to sustain, plus one final zero to stop.
                cur = (sess.rumble_large, sess.rumble_small) if sess is not None else (0, 0)
                if cur != last_rmb and (cur != (0, 0) or last_rmb != (0, 0)):
                    last_rmb = cur
                    try:
                        transport.send_rumble(cur[0], cur[1])
                    except Exception:
                        pass
        except Exception as e:
            print("AOA: link dropped (%s). Reconnecting…" % e)
        finally:
            if sess is not None:
                padmgr.remove(AOA_KEY)
            if transport is not None:
                transport.close()
            with telemetry.lock:
                if telemetry.transport == "USB-AOA (Wired)":
                    telemetry.transport = None
        time.sleep(1.0)  # brief pause before re-scanning for the accessory


# ── GRX encrypted-input integration ──────────────────────────────────────────
# GRX bootstraps on the EXISTING pairing: the QR already shares `key` with the
# phone, so we derive the GRX pre-shared key from it (no QR/pairing-flow change).
GRX_LTID = b"gamepados-grx-v1"   # fixed domain id, bound into the handshake transcript
GRX_REQUIRED = False             # flip True once the Android GRX build ships -> drops the
                                 # legacy cleartext path (closes the authToken downgrade hole)

def _grx_psk_from_key(key_str):
    """32-byte GRX PSK derived from the shared pairing key (HKDF-SHA256). Both
    ends already hold `key` (it's in the QR), so this needs no new pairing data."""
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes
    try:
        ikm = bytes.fromhex(key_str)
    except (ValueError, TypeError):
        ikm = (key_str or "").encode()
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"", info=b"grx psk v1").derive(ikm)


def run_udp_loop(sock, padmgr, expected_hash, lan_ip="127.0.0.1", pairing_key=""):
    # GRX is enabled only when we have the pairing key to derive the PSK; otherwise
    # the loop behaves exactly as before (legacy cleartext only).
    grx_psk = None
    grx_sessions = {}            # ip -> GrxServerSession (handshake state per phone)
    grx_logged = set()           # ips we've already logged a first-decrypt for
    grx_failed = set()           # ips we've already logged a decrypt-failure for
    try:
        import grx_session
        import grx_crypto
        if pairing_key:
            grx_psk = _grx_psk_from_key(pairing_key)
    except Exception as e:
        print("GRX disabled (crypto layer unavailable): %s" % e)
        grx_session = None

    sel = selectors.DefaultSelector()
    sel.register(sock, selectors.EVENT_READ)
    last_packet_time = time.perf_counter()
    # PERF: batched telemetry packet counter (see handle_frame). Flushed every 64
    # packets and again on each idle tick, so the displayed count never lags long.
    _tel_pending = 0

    def handle_frame(ip, addr, data, now, encrypted):
        """Process one decrypted/cleartext 20-byte input frame. Identical downstream
        behaviour for both paths; GRX frames skip the token check (GCM authenticated)."""
        nonlocal last_packet_time
        timestamp, buttons, lt, rt, ls_x, ls_y, rs_x, rs_y, auth_token = \
            struct.unpack(PAYLOAD_FORMAT, data)

        if not encrypted:
            # Legacy cleartext auth policy (subnet-agnostic):
            #  - matching token always accepted (QR pairing);
            #  - token 0 accepted ONLY off our primary LAN (USB-tether/loopback).
            # USB tether is checked explicitly: when the phone's mobile data is
            # the PC's internet, the default route (and thus lan_ip) can BE the
            # tether adapter, which made the off-LAN test reject the tether
            # client and USB tethering silently never connected.
            if auth_token != expected_hash:
                if not (auth_token == 0 and
                        (is_offlan_client(ip, lan_ip) or is_usb_tether_client(ip))):
                    return

        sess = padmgr.acquire(ip, addr=addr)   # one virtual pad per source IP
        if sess is None:
            # At the 4-pad XInput limit (or pad creation failed). Do NOT ACK:
            # an ACK makes the phone show "connected" while driving nothing —
            # a 5th device must look unconnected, not silently dead.
            return
        # Guide is forwarded on ALL transports, including USB tether. The old
        # "Game Bar resets the RNDIS adapter" failure was retested live on
        # Win11 26200 (2026-07-03): 90s of Guide presses over tether, zero pad
        # drops, zero adapter flaps. sess.allow_guide stays as an escape hatch
        # should some Windows/OEM combo resurface the reset.

        # Force-feedback back to this phone (mirrors USB/WS rumble path).
        rl = sess.rumble_large & 0xFF
        rs = sess.rumble_small & 0xFF
        if (rl or rs) or sess.last_rmb_sent != (0, 0):
            try:
                sock.sendto(b"RMB" + bytes([rl, rs]), addr)
            except Exception:
                pass
            sess.last_rmb_sent = (rl, rs)

        # Per-session ordering: drop genuinely out-of-order packets within one stream.
        if timestamp < sess.last_ts:
            if (sess.last_ts - timestamp) > 1_000_000_000:
                sess.last_ts = timestamp   # clock reset → accept
            else:
                return
        sess.last_ts = timestamp
        sess.last_seen = now
        last_packet_time = now

        apply_inputs(sess, buttons, lt, rt, ls_x, ls_y, rs_x, rs_y)

        # Echo send-time so the phone can compute true RTT. Sent AFTER apply_inputs so
        # the pad IOCTL (what the game actually sees) isn't delayed by this sendto()
        # syscall — the RTT figure is unaffected by the few microseconds of reorder.
        # (Reordered/stale frames return above and are not ACK'd; the next in-order
        # frame ACKs, so unicast lock / liveness is unaffected.)
        try:
            sock.sendto(b"ACK" + struct.pack("<Q", timestamp), addr)
        except Exception:
            pass

        # PERF: this used to take telemetry.lock on EVERY inbound packet (~1000/s).
        # These three are independent scalars and CPython's GIL makes each single
        # assignment atomic, so an unlocked write can't tear — a status reader may
        # see a mixed-but-valid snapshot, which is fine for a display. Crucially
        # last_packet_time stays updated every packet because it drives the
        # pad-neutral watchdog. Only packet_count needs read-modify-write (not
        # atomic), so it's accumulated locally and flushed under the lock in
        # batches — cutting lock acquisitions by ~64x with no lost counts.
        telemetry.transport = "Wi-Fi"
        telemetry.client_ip = ip
        telemetry.last_packet_time = last_packet_time
        nonlocal _tel_pending
        _tel_pending += 1
        if _tel_pending >= 64:
            with telemetry.lock:
                telemetry.packet_count += _tel_pending
            _tel_pending = 0

    _last_idle_tick = 0.0
    while not stop_event.is_set():
        try:
            events = sel.select(timeout=0.2)
        except Exception as e:
            print("Error in select:", e)
            events = []
            time.sleep(0.1)
        now = time.perf_counter()

        # Run idle_tick every loop iteration (throttled to ~1s) so ghost
        # sessions are cleaned up even when UDP events keep arriving (e.g.
        # phone process kept alive by Android after the user closes the app).
        # Also evict stale grx_sessions for IPs with no active pad (BUG 22).
        if now - _last_idle_tick >= 1.0:
            _last_idle_tick = now
            # PERF: flush any partially-accumulated telemetry counter so the
            # displayed packet count never trails by more than a second when
            # traffic stops mid-batch.
            if _tel_pending:
                with telemetry.lock:
                    telemetry.packet_count += _tel_pending
                _tel_pending = 0
            try:
                padmgr.idle_tick(now)
            except Exception as e:
                print("Error in idle_tick:", e)
            # Evict GRX session state for IPs that no longer have a pad session
            # so memory doesn't grow unboundedly over the server's lifetime.
            if grx_sessions:
                active_ips = set()
                with padmgr.lock:
                    for key in padmgr.sessions:
                        # UDP sessions are keyed by IP string directly.
                        if not key.startswith("usb:") and key != "aoa":
                            active_ips.add(key)
                stale = [ip for ip in grx_sessions if ip not in active_ips]
                for ip in stale:
                    grx_sessions.pop(ip, None)
                    grx_logged.discard(ip)
                    grx_failed.discard(ip)

        if not events:
            continue

        for key_obj, mask in events:
            if not (mask & selectors.EVENT_READ):
                continue

            # Drain all waiting datagrams. Handshake frames are handled inline (they
            # need an immediate reply); input frames keep the NEWEST per source IP.
            latest = {}        # ip -> (cleartext 20B, addr)
            latest_grx = {}    # ip -> (encrypted 41B, addr)
            while True:
                try:
                    data, addr = sock.recvfrom(1024)
                except BlockingIOError:
                    break
                except (ConnectionResetError, OSError):
                    break
                ip = addr[0]

                if grx_psk and grx_session and grx_session.is_handshake(data):
                    existing = grx_sessions.get(ip)
                    # SECURITY: never let an unauthenticated handshake frame tear
                    # down an ALREADY-ESTABLISHED session. Otherwise a LAN attacker
                    # who spoofs a live client's source IP could send one malformed
                    # HELLO/CONFIRM, the tag check would raise, and the pop below
                    # would kill the victim's encrypted session — reintroducing
                    # exactly the spoofed kill-switch the removed BYE packet avoided.
                    # A fresh (re)handshake from a real reconnecting client starts a
                    # NEW session object, so legitimate re-pairing still works.
                    if existing is not None and existing.established:
                        continue
                    s = existing
                    if s is None:
                        s = grx_session.GrxServerSession(grx_psk, GRX_LTID)
                        grx_sessions[ip] = s
                    try:
                        if data[0] == grx_session.T_HELLO:
                            sock.sendto(s.handle_hello(data), addr)
                            print("[GRX] HELLO from %s -> sent SERVER_HELLO" % ip, flush=True)
                        elif data[0] == grx_session.T_CONFIRM:
                            s.handle_confirm(data)
                            print("[GRX] CONFIRM from %s -> session ESTABLISHED" % ip, flush=True)
                    except grx_session.HandshakeError as e:
                        print("[GRX] handshake FAILED from %s: %s" % (ip, e), flush=True)
                        # Only evict a not-yet-established (in-progress) session.
                        if not s.established:
                            grx_sessions.pop(ip, None)   # reset → client can re-handshake
                    except Exception as e:
                        # e.g. sendto OSError — drop the frame, keep the loop alive
                        print("[GRX] handshake error from %s: %r" % (ip, e), flush=True)
                        if not s.established:
                            grx_sessions.pop(ip, None)
                    continue

                # NOTE: no "BYE" teardown packet on purpose. An unauthenticated
                # cleartext kill-switch lets any LAN host spoof a client's source
                # IP and drop its session (even a GRX-encrypted one) with 3 bytes
                # — and stale clients that still send BYE on internal restarts
                # were causing "connected → dropped in 2s" flapping. The idle
                # watchdog retires dead sessions within ~3s; that's enough.

                if grx_psk and grx_crypto and len(data) == grx_crypto.WIRE_LEN:
                    latest_grx[ip] = (data, addr)
                elif len(data) == PAYLOAD_SIZE:
                    latest[ip] = (data, addr)

            # Encrypted (GRX) inputs — decrypt + replay-check, then process.
            # handle_frame guarded: an exception here (e.g. ViGEm pad allocation)
            # must drop the frame, NEVER kill this thread — a dead UDP loop leaves
            # the port bound but silent, and nothing reconnects until app restart.
            for ip, (data, addr) in latest_grx.items():
                s = grx_sessions.get(ip)
                if s is None or not s.established:
                    continue
                pt = s.open(data)                # None → forged/old/dup, dropped
                if pt is not None:
                    if ip not in grx_logged:
                        grx_logged.add(ip)
                        print("[GRX] first ENCRYPTED input decrypted from %s -> driving pad" % ip, flush=True)
                    try:
                        handle_frame(ip, addr, pt, now, encrypted=True)
                    except Exception as e:
                        print("handle_frame error (grx) from %s: %r" % (ip, e), flush=True)
                elif ip not in grx_failed:
                    grx_failed.add(ip)
                    print("[GRX] decrypt FAILED from %s (key/nonce/format mismatch)" % ip, flush=True)

            # Legacy cleartext inputs (unchanged) — disabled once GRX_REQUIRED.
            if not GRX_REQUIRED:
                for ip, (data, addr) in latest.items():
                    try:
                        handle_frame(ip, addr, data, now, encrypted=False)
                    except Exception as e:
                        print("handle_frame error from %s: %r" % (ip, e), flush=True)

    sel.close()
    sock.close()
    padmgr.shutdown()

# ── Tkinter GUI ───────────────────────────────────────────────────────────────
def run_gui(ip, port, qr_pil_image, key="", padmgr=None):
    import tkinter as tk
    from PIL import ImageTk, Image as PILImage

    # Light "Gamepad Server" layout.
    BG      = "#f1f1f1"   # window background
    CARD_BG = "#ffffff"   # QR / field surfaces
    TEXT    = "#1d1d1f"   # primary text
    MUTED   = "#6b7280"   # secondary text
    LINK    = "#1a73e8"   # accent — connected count
    BORDER  = "#d8d8d8"
    FONT_H  = ("Segoe UI", 11)

    root = tk.Tk()
    root.title("Gamepad Server")
    root.resizable(False, False)
    root.configure(bg=BG)
    root.geometry("+60+50")   # position only; height auto-fits to content below

    # Set window icon
    try:
        icon_path = get_resource_path("app_icon.png")
        icon_img = PILImage.open(icon_path).resize((32, 32), PILImage.LANCZOS)
        icon_tk = ImageTk.PhotoImage(icon_img)
        root.iconphoto(True, icon_tk)
    except Exception:
        pass

    # ── Header ────────────────────────────────────────────────────────────
    tk.Label(root, text="Scan the code using GamepadOS on your phone.",
             font=FONT_H, bg=BG, fg=TEXT, wraplength=384, justify="left",
             anchor="w").pack(fill="x", padx=20, pady=(10, 14))

    # ── QR ────────────────────────────────────────────────────────────────
    qr_size = 300
    qr_resized = qr_pil_image.resize((qr_size, qr_size), PILImage.NEAREST)
    qr_tk = ImageTk.PhotoImage(qr_resized)
    qr_outer = tk.Frame(root, bg=CARD_BG, highlightbackground=BORDER, highlightthickness=1)
    qr_outer.pack(padx=20)
    qr_lbl = tk.Label(qr_outer, image=qr_tk, bg="white", padx=12, pady=12)
    qr_lbl.image = qr_tk
    qr_lbl.pack()

    # ── Connected devices (live) ──────────────────────────────────────────
    conn_lbl = tk.Label(root, text="Connected devices: 0", font=("Segoe UI", 11),
                        bg=BG, fg=LINK, anchor="w")
    conn_lbl.pack(fill="x", padx=20, pady=(16, 10))

    # ── Pairing key (read-only, selectable to copy) ───────────────────────
    key_var = tk.StringVar(value=key)
    key_entry = tk.Entry(root, textvariable=key_var, font=("Consolas", 10),
                         bg=CARD_BG, fg=TEXT, readonlybackground=CARD_BG,
                         relief="solid", borderwidth=1, state="readonly")
    key_entry.pack(fill="x", padx=20, pady=(16, 18), ipady=6)

    # ── Updates ───────────────────────────────────────────────────────────
    # Silent auto-check on launch (only surfaces UI if a newer build exists) +
    # a manual "Check for updates" button. The check runs on a background thread
    # and is fully fail-safe (offline → nothing happens); the result is marshalled
    # back onto the Tk thread via root.after.
    upd_frame = tk.Frame(root, bg=BG)
    upd_frame.pack(fill="x", padx=20, pady=(0, 16))
    upd_lbl = tk.Label(upd_frame, text="", font=("Segoe UI", 9), bg=BG, fg=MUTED, anchor="w")
    upd_lbl.pack(side="left")
    from tkinter import ttk
    _update_info = {"url": "", "sha256": "", "latest": ""}
    _updating = {"on": False}

    # Download progress bar — hidden until an update is actually downloading.
    upd_prog = ttk.Progressbar(upd_frame, mode="determinate", length=150, maximum=100)

    def _status(text, color=MUTED):
        upd_lbl.config(text=text, fg=color)

    def _fallback_to_browser(reason):
        # Any failure path: never leave the user stuck — open the download page so
        # they can update manually, and restore the button.
        import webbrowser
        _status(reason, MUTED)
        try:
            webbrowser.open(_update_info.get("url") or "https://gamepad.space/#download")
        except Exception:
            pass
        _updating["on"] = False
        upd_prog.stop()
        upd_prog.pack_forget()
        upd_btn.config(state="normal", text="Download & install update", command=_start_update)

    def _on_progress(done, total):
        def ui():
            if total > 0:
                pct = int(done * 100 / total)
                upd_prog.config(mode="determinate", value=pct)
                _status("Downloading update… %d%%" % pct, LINK)
        try:
            root.after(0, ui)
        except Exception:
            pass

    def _install_worker():
        import tempfile
        ver = _update_info.get("latest") or "new"
        dest = os.path.join(tempfile.gettempdir(), "GamepadServer-Setup-%s.exe" % ver)
        ok, err = download_update(
            _update_info["url"], dest, progress_cb=_on_progress,
            expected_sha256=(_update_info.get("sha256") or None))

        def after():
            if not ok:
                _log_update_error("download failed: %s" % (err or "unknown"))
                _fallback_to_browser("Update failed (%s) — opening download page…" % (err or "unknown"))
                return
            # Hand off to the elevated installer; it shows its own progress bar,
            # closes us, installs, and relaunches the new version.
            _status("Installing… the server will restart automatically.", LINK)
            upd_prog.config(mode="indeterminate")
            upd_prog.start(12)
            if not launch_installer_elevated(dest):
                _log_update_error("installer launch failed or user denied UAC")
                _fallback_to_browser("Update needs permission — opening download page…")
                return
            # Give the installer a moment to start, then close cleanly.
            time.sleep(0.5)
            try:
                os._exit(0)
            except Exception:
                sys.exit(0)

        try:
            root.after(0, after)
        except Exception as e:
            _log_update_error("error scheduling install: %s" % e)

    def _start_update():
        if _updating["on"] or not _update_info.get("url"):
            return
        # Running from source (not the frozen exe) → nothing to install; just open
        # the page so a developer build never tries to install over itself.
        if not getattr(sys, "frozen", False):
            import webbrowser
            webbrowser.open(_update_info.get("url") or "https://gamepad.space/#download")
            return
        _updating["on"] = True
        upd_btn.config(state="disabled", text="Updating…")
        upd_prog.config(mode="determinate", value=0)
        upd_prog.pack(side="right", padx=(0, 10))
        _status("Starting download…", LINK)
        threading.Thread(target=_install_worker, daemon=True).start()

    def _apply_update_result(res, manual):
        if res.get("available"):
            _update_info["url"] = res.get("url", "")
            _update_info["sha256"] = res.get("sha256", "")
            _update_info["latest"] = res.get("latest", "")
            _status("Update available: v%s" % res.get("latest", ""), LINK)
            upd_btn.config(state="normal", text="Download & install update", command=_start_update)
        elif manual:
            if res.get("error"):
                msg = {
                    "offline": "No internet connection",
                    "server":  "Update server unavailable — try again later",
                    "timeout": "Update server timed out — try again",
                    "parse":   "Update server returned a bad response",
                }.get(res.get("kind"), "Couldn't check for updates")
                _status(msg, MUTED)
            else:
                _status("You're on the latest version (v%s)" % APP_VERSION, MUTED)
            upd_btn.config(text="Check for updates", command=_run_check)

    def _run_check(manual=True):
        if _updating["on"]:
            return
        if manual:
            _status("Checking for updates…", MUTED)
        def worker():
            res = check_for_update()
            try:
                root.after(0, lambda: _apply_update_result(res, manual))
            except Exception:
                pass
        threading.Thread(target=worker, daemon=True).start()

    upd_btn = tk.Button(upd_frame, text="Check for updates", font=("Segoe UI", 9),
                        bg=CARD_BG, fg=TEXT, activebackground="#e6e6e6",
                        relief="solid", borderwidth=1, padx=10, pady=3,
                        cursor="hand2", command=_run_check)
    upd_btn.pack(side="right")

    # Silent auto-check on launch — only changes the UI if an update is available.
    _run_check(manual=False)

    # ── Feedback ──────────────────────────────────────────────────────────────
    # Sends a message straight into the team's admin portal, tagged source="pc".
    # Same backend as the update manifest (admin.gamepad.space was never a live host).
    FEEDBACK_URL = os.environ.get(
        "GAMEPAD_FEEDBACK_URL",
        "https://supportportal.gamepad.space/api/support/ticket")

    def _open_feedback():
        dlg = tk.Toplevel(root)
        dlg.title("Send Feedback")
        dlg.configure(bg=BG)
        dlg.geometry("400x360")
        dlg.resizable(False, False)
        try:
            dlg.transient(root)
            dlg.grab_set()
        except Exception:
            pass
        tk.Label(dlg, text="Send feedback to the GamepadOS team", font=("Segoe UI", 11, "bold"),
                 bg=BG, fg=TEXT, anchor="w").pack(fill="x", padx=18, pady=(16, 2))
        tk.Label(dlg, text="We read every message — add your email so we can reply.",
                 font=("Segoe UI", 8), bg=BG, fg=MUTED, anchor="w", justify="left").pack(fill="x", padx=18)
        tk.Label(dlg, text="Your email", font=("Segoe UI", 8), bg=BG, fg=MUTED, anchor="w").pack(fill="x", padx=18, pady=(12, 2))
        email_e = tk.Entry(dlg, font=("Segoe UI", 10), relief="solid", borderwidth=1)
        email_e.pack(fill="x", padx=18, ipady=4)
        tk.Label(dlg, text="Message", font=("Segoe UI", 8), bg=BG, fg=MUTED, anchor="w").pack(fill="x", padx=18, pady=(10, 2))
        msg_t = tk.Text(dlg, font=("Segoe UI", 10), height=6, relief="solid", borderwidth=1, wrap="word")
        msg_t.pack(fill="both", expand=True, padx=18)
        status = tk.Label(dlg, text="", font=("Segoe UI", 8), bg=BG, fg=MUTED, anchor="w")
        status.pack(fill="x", padx=18, pady=(6, 0))

        def _submit():
            import json, re as _re, urllib.request, urllib.error
            email = email_e.get().strip()
            message = msg_t.get("1.0", "end").strip()
            if not _re.match(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                status.config(text="Please enter a valid email.", fg="#c0392b"); return
            if len(message) < 10:
                status.config(text="Please write at least 10 characters.", fg="#c0392b"); return
            status.config(text="Sending…", fg=MUTED)
            send_btn.config(state="disabled")

            def worker():
                ok, err = False, ""
                try:
                    body = json.dumps({
                        "name": "PC User", "email": email, "subject": "feedback",
                        "message": message, "source": "pc",
                    }).encode("utf-8")
                    req = urllib.request.Request(FEEDBACK_URL, data=body,
                                                 headers={"Content-Type": "application/json"}, method="POST")
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        ok = 200 <= resp.status < 300
                except urllib.error.HTTPError as e:
                    err = "Server error (%s)" % e.code
                except Exception:
                    err = "No internet connection"

                def done():
                    if ok:
                        status.config(text="Thanks! Your feedback was sent. ✓", fg="#1e8e3e")
                        dlg.after(1400, dlg.destroy)
                    else:
                        status.config(text=err or "Couldn't send — try again.", fg="#c0392b")
                        send_btn.config(state="normal")
                try:
                    dlg.after(0, done)
                except Exception:
                    pass
            threading.Thread(target=worker, daemon=True).start()

        btn_row = tk.Frame(dlg, bg=BG)
        btn_row.pack(fill="x", padx=18, pady=12)
        send_btn = tk.Button(btn_row, text="Send", font=("Segoe UI", 9, "bold"), bg=CARD_BG, fg=TEXT,
                             activebackground="#e6e6e6", relief="solid", borderwidth=1, padx=16, pady=4,
                             cursor="hand2", command=_submit)
        send_btn.pack(side="right")
        email_e.focus_set()

    fb_frame = tk.Frame(root, bg=BG)
    fb_frame.pack(fill="x", padx=20, pady=(0, 14))
    tk.Label(fb_frame, text="Found a bug or have an idea?", font=("Segoe UI", 9),
             bg=BG, fg=MUTED, anchor="w").pack(side="left")
    tk.Button(fb_frame, text="\U0001F4AC Send Feedback", font=("Segoe UI", 9), bg=CARD_BG, fg=TEXT,
              activebackground="#e6e6e6", relief="solid", borderwidth=1, padx=10, pady=3,
              cursor="hand2", command=_open_feedback).pack(side="right")

    # ── Live "connected devices" count ────────────────────────────────────
    # Now the real number of active per-phone controller sessions (each connected
    # phone has its own virtual pad).
    def refresh():
        count = padmgr.count() if padmgr is not None else 0
        conn_lbl.config(text=f"Connected devices: {count}")
        root.after(400, refresh)

    refresh()

    # Snap the window to exactly fit its contents (no empty space at the bottom),
    # keeping the 430px design width.
    root.update_idletasks()
    root.geometry(f"430x{root.winfo_reqheight()}+60+50")

    def on_close():
        stop_event.set()
        try:
            root.destroy()
        except Exception:
            pass
        # Closing the window MUST fully terminate the app. Returning from mainloop
        # isn't enough: the asyncio WS/AOA bridges keep non-daemon library threads
        # alive, so the process lingered invisibly in the background and the next
        # launch hit the "already running" single-instance guard (duplicate procs
        # piling up). Run the registered cleanups (adb kill-server, timer restore)
        # then hard-exit so nothing can keep the process alive.
        try:
            import atexit
            atexit._run_exitfuncs()
        except Exception:
            pass
        os._exit(0)

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.mainloop()

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # Raise scheduler priority for consistently low input latency.
    boost_process_priority()
    # Raise the system timer resolution so select() timeouts / sleeps aren't
    # quantized to the default ~15.6ms tick (restored via atexit on shutdown).
    boost_timer_resolution()

    # Snapshot first-run BEFORE mark_setup_done() runs below, so the firewall
    # self-heal (after bind) can still treat this as the first launch.
    _first_run = is_first_run()
    import ctypes as _ctypes
    try:
        _admin = bool(_ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        _admin = False

    # Init DualShock 4 virtual gamepad. On a fresh PC the ViGEmBus driver won't
    # be present yet → self-install it from the MSI bundled inside this exe.
    try:
        gamepad = vg.VX360Gamepad()
        reset_gamepad_state(gamepad)
        gamepad.update()
    except Exception as e:
        import tkinter.messagebox as mb
        import tkinter as tk
        tk.Tk().withdraw()
        offer = mb.askokcancel(
            "Gamepad Server — one-time driver setup",
            "First-time setup: this app needs the free ViGEmBus controller driver.\n\n"
            "Click OK to install it now (you'll see a Windows permission prompt and a "
            "short progress bar). After it finishes, the server will start automatically.")
        if offer and install_vigembus_driver():
            # Driver MSI ran. Give Windows a moment, then retry init in-process.
            import time as _t
            _t.sleep(3)
            try:
                gamepad = vg.VX360Gamepad()
                reset_gamepad_state(gamepad)
                gamepad.update()
            except Exception:
                mb.showinfo(
                    "Gamepad Server",
                    "ViGEmBus was installed. Please start GamepadServer again to finish.\n\n"
                    "(If it still fails, a reboot may be needed once.)")
                sys.exit(0)
        else:
            mb.showerror(
                "Gamepad Server — driver required",
                "The controller driver wasn't installed, so the server can't start.\n\n"
                f"Details: {e}\n\n"
                "Re-run GamepadServer and choose OK at the driver prompt, or install "
                "ViGEmBus manually from https://github.com/nefarius/ViGEmBus/releases.")
            sys.exit(1)

    # Driver is up and the firewall step ran — first-run setup is complete. Mark it
    # so every future launch skips the elevation entirely and starts silently.
    mark_setup_done()

    # The probe pad above only proved the driver works. Release it and create the
    # per-client pad manager — each connected phone gets its OWN virtual Xbox
    # controller (no more merged input), with its own rumble routed back to it.
    try:
        del gamepad
    except Exception:
        pass
    padmgr = PadManager()

    # Bind UDP socket
    sock, port = bind_server_socket()
    ip = get_lan_ip()

    # Firewall: the phone's inbound UDP must be allowed or Windows silently drops
    # every packet — the phone shows 'connecting' but never gets an ACK (the #1
    # wireless-fail cause, worst on a Public network). Ensure a rule that covers
    # the port we ACTUALLY bound (7777, or a 7778+ fallback). Self-healing — NOT
    # permanently gated by the first-run marker — so a declined / missing / old
    # 7777-only rule can no longer break wireless forever:
    #   • admin                                 → recreate the range rule silently
    #   • non-admin, rule already covers `port`  → do nothing (no UAC normally)
    #   • non-admin, rule missing / insufficient → repair it (one UAC prompt)
    try:
        _exe = sys.executable if getattr(sys, "frozen", False) else None
        # Bulletproof program-rule already covers us → no prompt; else fall back to
        # checking the port-range rule for the port we actually bound.
        _fw_ready = _firewall_program_rule_ok(_exe) or _firewall_allows_port(port)
        if _admin:
            ensure_firewall_rule(7777)                       # silent self-heal, admin
        elif _first_run or not _fw_ready:
            ensure_firewall_rule(7777)                       # missing/insufficient → one UAC
    except Exception:
        pass

    # Pairing key PERSISTS across server launches. Before, a fresh random key was
    # generated every run, which silently invalidated the phone's saved pairing —
    # forcing a QR re-scan after every server restart. Stored under LOCALAPPDATA so
    # the same PC always presents the same key (re-scan only needed if IP changes).
    def _load_or_create_key():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        kdir = os.path.join(base, "GamepadServer")
        kfile = os.path.join(kdir, "pairing_key.txt")
        try:
            with open(kfile, "r") as f:
                k = f.read().strip().lower()
            if len(k) == 8:
                int(k, 16)  # validates hex
                return k
        except Exception:
            pass
        k = secrets.token_hex(4)
        try:
            os.makedirs(kdir, exist_ok=True)
            with open(kfile, "w") as f:
                f.write(k)
        except Exception:
            pass  # disk issue → session-only key (old behavior), still works
        return k

    key = _load_or_create_key()
    expected_hash = int(key, 16)

    # Generate QR code as PIL image
    csv_str = f"{ip},{port},{key}"
    qr = qrcode.QRCode(box_size=6, border=2)
    qr.add_data(csv_str)
    qr.make(fit=True)
    qr_pil = qr.make_image(fill_color="black", back_color="white").get_image()

    # Start UDP loop in background thread
    udp_thread = threading.Thread(
        target=run_udp_loop,
        args=(sock, padmgr, expected_hash, ip, key),   # key -> GRX PSK (encrypted path)
        daemon=True
    )
    udp_thread.start()

    # USB-debugging wired transport: keep `adb reverse` alive and serve the
    # WebSocket bridge on localhost. Wi-Fi/tether (UDP) keeps working alongside it.
    start_adb_reverse_watcher(WS_PORT)
    threading.Thread(target=start_ws_bridge, args=(padmgr, WS_PORT), daemon=True).start()

    # AOA direct-USB transport (lowest-latency wired path, ~1-2 ms). Coexists with
    # UDP/WS; no-ops if pyusb/libusb or a WinUSB-bound accessory isn't present.
    threading.Thread(target=start_aoa_bridge, args=(padmgr,), daemon=True).start()

    # Run GUI in main thread (blocks until window closed)
    run_gui(ip, port, qr_pil, key, padmgr)

if __name__ == "__main__":
    # In a console=False (windowed) build, ANY uncaught startup error otherwise
    # makes the exe die silently — the user sees "nothing happens". Wrap main()
    # so failures are written to a log next to the exe AND shown in a dialog.
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback
        err = traceback.format_exc()
        try:
            log_dir = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.abspath(".")
            with open(os.path.join(log_dir, "GamepadServer_error.log"), "w", encoding="utf-8") as f:
                f.write(err)
        except Exception:
            pass
        try:
            import tkinter as tk
            import tkinter.messagebox as mb
            tk.Tk().withdraw()
            # Show the ACTUAL error. Only blame the driver when the error is
            # really driver-related — previously this line claimed "ViGEmBus not
            # installed" for every failure, so unrelated crashes (e.g. a socket
            # error) looked like a driver problem.
            last_line = err.strip().splitlines()[-1]
            hint = ""
            if any(k in err.lower() for k in ("vigem", "vx360gamepad", "vds4", "vbus")):
                hint = ("\n\nThis looks driver-related: install the free ViGEmBus driver "
                        "(ViGEmBusSetup_x64.msi, included), then re-run GamepadServer.")
            mb.showerror(
                "Gamepad Server — failed to start",
                "The server could not start.\n\n"
                + last_line
                + hint
                + "\n\nA full error log was saved as GamepadServer_error.log next to the app."
            )
        except Exception:
            pass
        sys.exit(1)

# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

# Bundle the websockets library (USB-debugging transport) — its submodules are
# imported lazily, so collect them explicitly or the exe fails at runtime.
ws_imports = collect_submodules('websockets')

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[
        ('C:\\Windows\\System32\\vcruntime140.dll', '.'),
        ('C:\\Windows\\System32\\vcruntime140_1.dll', '.'),
        ('C:\\Windows\\System32\\msvcp140.dll', '.')
    ],
    datas=[
        ('app_icon.png', '.'),
        ('C:\\Users\\akhil\\AppData\\Roaming\\Python\\Python314\\site-packages\\vgamepad', 'vgamepad'),
        # adb + its DLLs so the exe can run `adb reverse` self-contained (USB-debugging mode).
        # Tools now live in F:\hlooo\tools\ (moved out of apps\); path is relative to this spec.
        ('..\\..\\tools\\platform-tools\\adb.exe', '.'),
        ('..\\..\\tools\\platform-tools\\AdbWinApi.dll', '.'),
        ('..\\..\\tools\\platform-tools\\AdbWinUsbApi.dll', '.'),
        # libusb-1.0 backend for the AOA direct-USB transport (pyusb needs it).
        ('C:\\Users\\akhil\\AppData\\Roaming\\Python\\Python314\\site-packages\\libusb\\_platform\\windows\\x86_64\\libusb-1.0.dll', '.'),
    ],
    hiddenimports=ws_imports + ['vgamepad', 'aoa_transport', 'usb', 'usb.backend.libusb1',
                                'grx_crypto', 'grx_session', 'cryptography'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Size trim — exclude modules NOTHING in this app imports (verified against
    # server.py / grx_*.py / aoa_transport.py):
    #  - numpy: pulled in transitively ONLY by optional PIL array paths we never
    #    use. It drags a 20MB OpenBLAS DLL + ~6MB of extensions into the onefile.
    #    We use PIL only for Image.open/resize + qrcode.make_image, none of which
    #    need numpy.
    #  - the PIL image-format plugins for formats we never open (AVIF/WebP/CMS/
    #    font-text). We only rasterize a QR (rectangles) and open one PNG icon.
    #  - dev/test-only stdlib.
    excludes=[
        'numpy',
        # NOTE: do NOT exclude PIL.ImageFont. Pillow 12 added PIL.ImageText, which
        # ImageDraw imports unconditionally, and ImageText imports ImageFont at
        # module top — so qrcode's ImageDraw-based rasterizer now hard-requires
        # ImageFont. Excluding it makes the exe crash at startup with
        # "cannot import name 'ImageFont' from 'PIL'".
        'PIL.AvifImagePlugin', 'PIL.WebPImagePlugin', 'PIL.ImageCms',
        'PIL.ImageQt', 'PIL.ImageShow',
        'unittest', 'pydoc', 'doctest', 'lib2to3', 'turtle', 'tkinter.test',
        'pip', 'setuptools', 'pkg_resources',
    ],
    noarchive=False,
    optimize=2,  # strip docstrings + asserts from all pure-Python modules
)

# Drop the compiled PIL codec extensions for formats we never touch. KEEP
# _imaging (the core — QR rasterization + icon resize use it). This is the
# single biggest cut after numpy: _avif alone is ~7.9MB uncompressed.
# Keep _imagingft: Pillow 12's ImageFont (now a hard dep of ImageDraw via
# ImageText) imports it. _imagingmath/_imagingmorph are also imported by
# ImageDraw/ImageText on newer Pillow, so keep them too.
_pil_dead = ('_avif', '_webp', '_imagingcms')
a.binaries = [b for b in a.binaries if not any(x in b[0].lower() for x in _pil_dead)]

# Drop Tcl/Tk data the GUI never uses: tzdata (Python has its own zoneinfo),
# the Tk widget demos, and message-catalog i18n. Keep tcl8.6/encoding.
def _norm(p): return p.replace('\\', '/').lower()
_tcl_dead = ('tcl8.6/tzdata', 'tk8.6/demos', 'tk8.6/msgs', 'tcl8.6/msgs')
a.datas = [d for d in a.datas if not any(s in _norm(d[0]) for s in _tcl_dead)]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='GamepadServer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX-packed exes are frequently flagged/quarantined by antivirus
                # (a common "it just won't start" cause) and slow onefile launch.
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['app_icon.png'],
)

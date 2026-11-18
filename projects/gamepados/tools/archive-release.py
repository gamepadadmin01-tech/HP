"""Archive a REAL release (one submitted to Google Play), so it can be found, reinstalled or rebuilt later.
Owner, 2026-11-18: "whenever you build a version (not a test version) and submit it to Google Play, copy the build
files somewhere as a version, with a clear name (date, version number…), minimum files, so we can replicate it."

    python tools/archive-release.py 2.1.0 73 --status "Sent to Google Play review 2026-11-18"

What it does (and checks):
  1. The version in app/build.gradle.kts must be the one given; every file's own version is checked too.
  2. Folder  releases/<date>_GamepadOS-<version>_code<code>/  with only:
       GamepadOS-<v>-code<c>-playstore.aab          what Google Play got
       GamepadOS-<v>-code<c>-playstore-mapping.txt  Play's crash-report decoder for that exact build
       GamepadOS-<v>-code<c>-website.apk            the website download
       GamepadOS-<v>-code<c>-uptodown.apk           Uptodown
       RELEASE.md                                   what it is, when, where it went, the exact code, how to rebuild
       SHA256SUMS.txt                               fingerprints, so a copy can be proven identical
     An existing releases/<version>/ folder is moved in and its files renamed (nothing is deleted).
  3. Git tags (bookmarks on the exact code): HP repo  gamepados-v<v>-code<c> ; website repo  app-v<v>-code<c>.
     Tags are local; they reach GitHub when the owner pushes (with tags).
  4. One row in projects/gamepados/RELEASES.md (tracked in git), the list of every real release.

Rebuilding an old release: check out its tag, run the normal build (RELEASE.md says how). To put an old version back
on Google Play it must be rebuilt with a NEW, higher version code: Play never accepts a code it has seen.
"""
import argparse, datetime, glob, hashlib, os, re, shutil, subprocess, sys

G = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))            # projects/gamepados
HP = os.path.dirname(os.path.dirname(G))                                     # D:/AKHIL/HP
APP = os.path.join(G, 'apps', 'android-client')
OUT = os.path.join(APP, 'app', 'build', 'outputs')
WEB = os.path.join(G, 'website')
BT = sorted(glob.glob(os.path.join(HP, 'toolchain', 'android-sdk', 'build-tools', '*')))[-1]
JAVA = os.path.join(G, 'tools', 'jdk', 'jdk-17.0.20.1+1')

def run(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=isinstance(cmd, str))
    if check and r.returncode: sys.exit(f'FAILED: {cmd}\n{r.stdout}\n{r.stderr}')
    return r.stdout.strip()

def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()

def apk_version(p):
    out = run([os.path.join(BT, 'aapt2.exe'), 'dump', 'badging', p])
    m = re.search(r"versionCode='(\d+)' versionName='([^']+)'", out)
    return (int(m.group(1)), m.group(2)) if m else (None, None)

def signer_sha1(p):
    env = dict(os.environ, JAVA_HOME=JAVA)
    out = subprocess.run([os.path.join(JAVA, 'bin', 'keytool.exe'), '-printcert', '-jarfile', p], capture_output=True, text=True, env=env).stdout
    m = re.search(r'SHA1:\s*([0-9A-F:]+)', out)
    return m.group(1) if m else 'unknown'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('version'); ap.add_argument('code', type=int)
    ap.add_argument('--status', default='Sent to Google Play review')
    ap.add_argument('--date', default=datetime.date.today().isoformat())
    a = ap.parse_args()
    v, c = a.version, a.code

    gradle = open(os.path.join(APP, 'app', 'build.gradle.kts'), encoding='utf-8').read()
    gc = int(re.search(r'^\s*versionCode = (\d+)', gradle, re.M).group(1))
    gv = re.search(r'^\s*versionName = "([^"]+)"', gradle, re.M).group(1)
    if (gc, gv) != (c, v): sys.exit(f'build.gradle.kts says {gv} ({gc}), not {v} ({c}).')

    name = f'{a.date}_GamepadOS-{v}_code{c}'
    dest = os.path.join(G, 'releases', name)
    legacy = os.path.join(G, 'releases', v)
    if os.path.isdir(legacy) and not os.path.exists(dest): shutil.move(legacy, dest)
    os.makedirs(dest, exist_ok=True)
    base = f'GamepadOS-{v}-code{c}'
    files = {
        f'{base}-playstore.aab': (os.path.join(OUT, 'bundle', 'playstoreRelease', 'app-playstore-release.aab'), f'GamepadOS-{v}-playstore.aab'),
        f'{base}-playstore-mapping.txt': (os.path.join(OUT, 'mapping', 'playstoreRelease', 'mapping.txt'), f'GamepadOS-{v}-playstore-mapping.txt'),
        f'{base}-website.apk': (os.path.join(OUT, 'apk', 'direct', 'release', 'app-direct-release.apk'), f'GamepadOS-{v}-website.apk'),
        f'{base}-uptodown.apk': (os.path.join(OUT, 'apk', 'uptodown', 'release', 'app-uptodown-release.apk'), f'GamepadOS-{v}-uptodown.apk'),
    }
    for final, (built, legacy_name) in files.items():
        fp, lp = os.path.join(dest, final), os.path.join(dest, legacy_name)
        if os.path.exists(fp): continue
        if os.path.exists(lp): os.rename(lp, fp)                    # an earlier copy, renamed (never deleted)
        else: shutil.copy2(built, fp)
    # every file's own version must match
    for final in files:
        if final.endswith('.apk'):
            got = apk_version(os.path.join(dest, final))
            if got != (c, v): sys.exit(f'{final} is {got}, not ({c}, {v}).')
    aab = os.path.join(dest, f'{base}-playstore.aab')
    import zipfile
    with zipfile.ZipFile(aab) as z:
        if v.encode() not in z.read('base/manifest/AndroidManifest.xml'): sys.exit('the AAB is not this version')
    sig = signer_sha1(aab)

    hp_commit = run(['git', 'rev-parse', 'HEAD'], cwd=HP)
    web_commit = run(['git', 'rev-parse', 'HEAD'], cwd=WEB)
    dirty = run(['git', 'status', '--porcelain', '--', 'projects/gamepados/apps'], cwd=HP)
    tag_hp, tag_web = f'gamepados-v{v}-code{c}', f'app-v{v}-code{c}'
    for repo, tag, msg in ((HP, tag_hp, f'GamepadOS {v} ({c}) — {a.status}'), (WEB, tag_web, f'Backend for GamepadOS app {v} ({c})')):
        if not run(['git', 'tag', '-l', tag], cwd=repo): run(['git', 'tag', '-a', tag, '-m', msg], cwd=repo)

    notes_old = os.path.join(dest, f'RELEASE-NOTES-{v}.md')
    whats_new = ''
    if os.path.exists(notes_old):
        txt = open(notes_old, encoding='utf-8').read()
        m = re.search(r'```\n(.*?)```', txt, re.S)
        whats_new = m.group(1).strip() if m else ''
        os.rename(notes_old, os.path.join(dest, '_notes-before-archive.md'))   # kept, renamed
    sums = {f: sha256(os.path.join(dest, f)) for f in files}
    open(os.path.join(dest, 'SHA256SUMS.txt'), 'w', encoding='utf-8', newline='\n').write(''.join(f'{h}  {f}\n' for f, h in sums.items()))
    rel = f"""# GamepadOS {v} (version code {c})

| | |
|---|---|
| Date | {a.date} |
| Status | {a.status} |
| Version | {v} — version code {c} |
| App code (HP repo) | `{hp_commit[:10]}` — tag `{tag_hp}` |
| Server code (website repo) | `{web_commit[:10]}` — tag `{tag_web}` |
| Signing key SHA-1 | `{sig}` (the ORIGINAL release key, keys/) |
| Built with | Gradle 9.8.2, JDK 17.0.20.1+1, UI bundles from apps/controller-ui (`npm run build:all`) |
{'| Warning | apps/ had uncommitted changes when archived |' + chr(10) if dirty else ''}
## What's new (Google Play)

```
{whats_new or '(not recorded)'}
```

## Files

| File | Went to |
|---|---|
| `{base}-playstore.aab` | Google Play (Production) |
| `{base}-playstore-mapping.txt` | Google Play, same release (crash-report decoder) |
| `{base}-website.apk` | website download |
| `{base}-uptodown.apk` | Uptodown |

Fingerprints: `SHA256SUMS.txt`.

## Rebuild this exact version

1. `git checkout {tag_hp}` in D:\\AKHIL\\HP (and `git checkout {tag_web}` in projects/gamepados/website for the server).
2. apps/controller-ui: `npm run build:all`, copy `dist/index.html` and `dist-play/index.html` into the Android assets
   (see CLAUDE.md "Two UI bundles").
3. apps/android-client: Gradle 9.8.2 `bundlePlaystoreRelease assembleDirectRelease assembleUptodownRelease`.
4. To SHIP it again on Google Play, raise versionCode above the newest one Play has seen first.
"""
    open(os.path.join(dest, 'RELEASE.md'), 'w', encoding='utf-8', newline='\n').write(rel)

    index = os.path.join(G, 'RELEASES.md')
    if not os.path.exists(index):
        open(index, 'w', encoding='utf-8', newline='\n').write(
            '# GamepadOS releases\n\nEvery real release (submitted to Google Play). Files: `releases/<folder>/` (on this PC, not in git).\n'
            'Code: the git tag (in git). Made by `tools/archive-release.py`.\n\n'
            '| Date | Version | Code | Status | Folder | App tag | Server tag |\n|---|---|---|---|---|---|---|\n')
    rows = open(index, encoding='utf-8').read()
    if f'`{name}`' not in rows:
        open(index, 'a', encoding='utf-8', newline='\n').write(f'| {a.date} | {v} | {c} | {a.status} | `{name}` | `{tag_hp}` | `{tag_web}` |\n')
    print(f'archived: releases/{name}')
    for f, h in sums.items(): print(f'  {f}  {h[:16]}…')
    print(f'  tags: {tag_hp} (HP), {tag_web} (website)  signer {sig}')
    if dirty: print('  WARNING: apps/ had uncommitted changes')

if __name__ == '__main__':
    main()

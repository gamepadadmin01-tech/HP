"""Original music for the GamepadOS 2.0 video, synthesised from scratch (2026-11-18).

No samples, no outside track: nothing here can trigger a YouTube Content ID claim.
120 BPM, A minor (Am - F - C - G, one bar each = 2 s), so every scene change in scene.html lands on a bar.

    python music.py play   -> out/music-play.wav  (32 s, with UI sounds on the taps, the connect chime and the end hit)
    python music.py web    -> out/music-web.wav   (15 s loop; the website plays it muted, but it is here if wanted)
"""
import sys, os
import numpy as np
from scipy.signal import butter, lfilter
from scipy.io import wavfile

SR = 48000
BPM = 120
BEAT = 60 / BPM
MODE = sys.argv[1] if len(sys.argv) > 1 else 'play'
DUR = 32.0 if MODE == 'play' else 15.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)


def lp(x, f, order=2):
    b, a = butter(order, f / (SR / 2), 'low'); return lfilter(b, a, x)


def hp(x, f, order=2):
    b, a = butter(order, f / (SR / 2), 'high'); return lfilter(b, a, x)


def bp(x, lo, hi):
    b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band'); return lfilter(b, a, x)


def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N: return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * gain * (1 - max(pan, 0))
    R[i:i + len(sig)] += sig * gain * (1 + min(pan, 0))


def saw(f, n, detune=0.0):
    ph = np.cumsum(np.full(n, f * (1 + detune) / SR)); return 2 * (ph % 1) - 1


def env(n, a, d):
    k = np.arange(n) / SR
    return np.minimum(1, k / max(a, 1e-4)) * np.exp(-k / d)


def note(m):  # midi -> Hz
    return 440 * 2 ** ((m - 69) / 12)


CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]   # Am F C G (A3-ish voicings)
ROOTS = [45, 41, 48, 43]                                           # A2 F2 C3 G2

play = MODE == 'play'
groove_from, groove_to = (4.0, 28.0) if play else (0.0, DUR)

# ---- kick, every beat in the groove ----
kn = int(0.45 * SR); kk = np.arange(kn) / SR
kick = np.sin(2 * np.pi * np.cumsum(45 + 110 * np.exp(-kk / 0.03)) / SR) * np.exp(-kk / 0.22)
kick += 0.3 * np.exp(-kk / 0.004) * rng.standard_normal(kn)
beats = np.arange(groove_from, groove_to, BEAT)
for b in beats: add(kick, b, 0.9)

# side-chain: everything except the kick ducks on each beat
duck = np.ones(N)
for b in beats:
    i = int(b * SR); n = min(int(0.4 * SR), N - i)
    duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.55 * np.exp(-np.arange(n) / SR / 0.11))

# ---- hats on the off-beats, a clap on 2 and 4 ----
hn = int(0.08 * SR)
for b in beats:
    hat = hp(rng.standard_normal(hn), 7000) * np.exp(-np.arange(hn) / SR / 0.025)
    add(hat, b + BEAT / 2, 0.16, pan=0.25)
cn = int(0.25 * SR)
for k, b in enumerate(beats):
    if k % 2 == 1:
        clap = bp(rng.standard_normal(cn), 900, 3500) * env(cn, 0.002, 0.07)
        add(clap, b, 0.35, pan=-0.1)

# ---- bass: filtered saw, eighth notes on the chord root ----
pad_l = np.zeros(N); pad_r = np.zeros(N); bass = np.zeros(N); arp = np.zeros(N)
bars = np.arange(0, DUR, 2.0)
for bi, b0 in enumerate(bars):
    ci = bi % 4
    if groove_from <= b0 < groove_to:
        for e in range(8):
            st = b0 + e * BEAT / 2; n = int(BEAT / 2 * SR * 0.92)
            i = int(st * SR)
            if i + n > N: n = N - i
            s = saw(note(ROOTS[ci]), n) * env(n, 0.004, 0.18)
            bass[i:i + n] += s
    # pad: three detuned saws per chord tone, whole bar
    n = int(2.0 * SR); i = int(b0 * SR); n = min(n, N - i)
    for m in CHORDS[ci]:
        for d, side in ((-0.004, 0), (0.0, 2), (0.004, 1)):
            s = saw(note(m), n, d) * 0.12
            if side in (0, 2): pad_l[i:i + n] += s
            if side in (1, 2): pad_r[i:i + n] += s
    # arp: sixteenths over the chord, an octave up
    tones = [m + 12 for m in CHORDS[ci]] + [CHORDS[ci][0] + 24]
    for k in range(16):
        st = b0 + k * BEAT / 4; nn = int(BEAT / 4 * SR)
        j = int(st * SR)
        if j + nn > N: nn = N - j
        if nn <= 0: continue
        f = note(tones[[0, 1, 2, 3, 2, 1][k % 6]])
        sq = np.sign(np.sin(2 * np.pi * f * np.arange(nn) / SR)) * env(nn, 0.002, 0.06)
        arp[j:j + nn] += sq

bass = lp(bass, 420, 3) * 0.55
pad_l = lp(pad_l, 1400); pad_r = lp(pad_r, 1400)
arp = lp(arp, 2600) * 0.07
# arp delay (dotted eighth), panned opposite
dl = int(BEAT * 0.75 * SR)
arp_d = np.zeros(N); arp_d[dl:] = arp[:-dl] * 0.45

# pad swells in over the intro; arp comes in at the groove (or from the start in the loop)
pad_gain = np.clip(t / 2.5, 0, 1) if play else np.ones(N)
arp_gain = np.clip((t - (2.0 if play else 0)) / 1.0, 0, 1)
L += (pad_l * pad_gain * 0.8 + bass + arp * arp_gain) * duck
R += (pad_r * pad_gain * 0.8 + bass + arp_d * arp_gain) * duck
R += arp * arp_gain * duck * 0.4; L += arp_d * arp_gain * duck * 0.4

if play:
    # ---- UI sounds that match the picture ----
    tn = int(0.12 * SR)
    for tt in (5.0, 6.0, 7.0):                      # d-pad taps
        click = np.sin(2 * np.pi * 1800 * np.arange(tn) / SR) * env(tn, 0.001, 0.018)
        add(click, tt, 0.22)
    cn2 = int(0.9 * SR)                              # connected chime at 14.0
    for k, m in enumerate([76, 83]):
        ch = np.sin(2 * np.pi * note(m) * np.arange(cn2) / SR) * env(cn2, 0.003, 0.35)
        add(ch, 14.0 + k * 0.09, 0.22)
    for k in range(3):                               # P2-P4 pop in
        pn = int(0.15 * SR); kk2 = np.arange(pn) / SR
        pop = np.sin(2 * np.pi * np.cumsum(500 + 900 * kk2 / 0.15) / SR) * env(pn, 0.002, 0.04)
        add(pop, 24.5 + k * 0.25, 0.18)
    # scene whooshes just before each bar change
    for b in (8.0, 12.0, 16.0, 20.0, 24.0):
        wn = int(0.6 * SR)
        w = bp(rng.standard_normal(wn), 500, 4000) * np.sin(np.linspace(0, np.pi, wn)) ** 2
        add(w, b - 0.45, 0.08)
    # riser into the end card, then a big chord with a long tail
    rn = int(2.0 * SR); rk = np.arange(rn) / rn
    riser = hp(rng.standard_normal(rn), 1500) * rk ** 2
    add(riser, 26.0, 0.18)
    en = N - int(28.0 * SR); ek = np.arange(en) / SR
    hit = np.zeros(en)
    for m in (45, 57, 60, 64, 71):                   # A minor add 9
        for d in (-0.003, 0.003):
            hit += saw(note(m), en, d) * 0.09
    hit = lp(hit, 2200) * np.minimum(1, ek / 0.01) * np.exp(-ek / 2.2)
    add(hit, 28.0, 1.0)
    add(kick, 28.0, 1.1)
    # fade the last second
    fade = np.clip((DUR - t) / 1.2, 0, 1); L *= fade; R *= fade
else:
    # loop: tiny fades at the joins so the wrap never clicks
    f = np.clip(np.minimum(t, DUR - t) / 0.01, 0, 1); L *= f; R *= f

mix = np.stack([L, R], 1)
mix = np.tanh(mix * 1.2) / np.tanh(1.2)
mix *= 0.89 / np.max(np.abs(mix))
os.makedirs(os.path.join(os.path.dirname(__file__), 'out'), exist_ok=True)
out = os.path.join(os.path.dirname(__file__), 'out', f'music-{MODE}.wav')
wavfile.write(out, SR, mix.astype(np.float32))
print(out)

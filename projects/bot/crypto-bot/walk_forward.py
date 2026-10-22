"""Walk-forward test: does the reward-trained entry agent reliably beat the Breakout rules?

For each test year Y (2021 .. 2026):
  * train the entries-only agent on the 3 years before Y (rolling window), several seeds
  * test it on year Y, which it has never seen, next to the Breakout rules and buy & hold

"Reliably beats" is decided before looking at the results:
  1. the learned agent's AVERAGE seed beats the rules in at least 75% of (year, coin) tests, and
  2. it still beats the rules on return PER CANDLE HELD in at least 75% of tests,
     so the win is not just from being in the market more, and
  3. its WORST seed beats the rules in more than half of the tests.

    python walk_forward.py --tf 1d
    python walk_forward.py --tf 4h --episodes 150
"""
import argparse

import numpy as np
import pandas as pd

import rl_agent as rl
from tradingview_data import load_candles

TEST_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN_YEARS = 3


def market_between(df, start, end):
    """Market for [start, end], with the earlier candles used only to warm up indicators."""
    end_ts = pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)  # include the whole last day
    m = rl.Market(df.loc[pd.Timestamp(start, tz="UTC") - pd.Timedelta(days=400):end_ts])
    keep = m.index >= pd.Timestamp(start, tz="UTC")
    s = int(np.argmax(keep))
    for k in ("o", "h", "l", "c", "market", "atr"):
        setattr(m, k, getattr(m, k)[s:])
    m.index, m.n = m.index[s:], m.n - s
    return m


def score(m, policy):
    t = pd.DataFrame(m.run_entries(policy))
    if t.empty:
        return dict(ret=0.0, trades=0, win=np.nan, avg_r=np.nan, exposure=0.0, per_bar=0.0)
    held = sum(m.index.get_loc(x) - m.index.get_loc(y) for x, y in zip(t.exit_time, t.entry_time))
    growth = (1 + 0.01 * t.r).prod()  # 1% of the account risked per trade
    return dict(ret=growth - 1, trades=len(t), win=(t.r > 0).mean(), avg_r=t.r.mean(), exposure=held / m.n,
                per_bar=growth ** (1 / max(held, 1)) - 1)


def rules(state, i):
    return int((state // rl.N_TRADE // 8) % 3 == 2)  # close above the 20-bar high


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tf", default="1d", choices=["1d", "4h"])
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--episodes", type=int, default=300)
    args = ap.parse_args()

    data = {c: load_candles(c, args.tf)[0] for c in rl.COINS}
    rows = []
    for year in TEST_YEARS:
        tr_start, tr_end = f"{year - TRAIN_YEARS}-01-01", f"{year - 1}-12-31"
        train_m = [market_between(data[c], tr_start, tr_end) for c in rl.COINS]
        test_m = {c: market_between(data[c], f"{year}-01-01", f"{year}-12-31") for c in rl.COINS}
        qs = [rl.train(train_m, args.episodes, seed=s, mode="entries") for s in range(args.seeds)]
        for c, m in zip(rl.COINS, train_m):  # in-sample scores, to see how well it memorised its training years
            base = dict(year=year, coin=c, train=f"{tr_start[:4]}-{tr_end[:4]}", split="train")
            rows.append(dict(base, agent="rules", seed=0, **score(m, rules)))
            for s, q in enumerate(qs):
                rows.append(dict(base, agent="learned", seed=s, **score(m, lambda st, i, q=q: int(q[st].argmax()))))
        for c in rl.COINS:
            m = test_m[c]
            base = dict(year=year, coin=c, train=f"{tr_start[:4]}-{tr_end[:4]}", split="test")
            rows.append(dict(base, agent="rules", seed=0, **score(m, rules)))
            rows.append(dict(base, agent="hold", seed=0, ret=m.c[-1] / m.o[0] - 1, trades=1, avg_r=np.nan,
                             exposure=1.0, per_bar=np.nan))
            for s, q in enumerate(qs):
                rows.append(dict(base, agent="learned", seed=s, **score(m, lambda st, i, q=q: int(q[st].argmax()))))
        print(f"{year} done (trained on {tr_start[:4]}-{tr_end[:4]})", flush=True)

    res = pd.DataFrame(rows)
    res.to_csv(rl.RESULTS / f"walk_forward_{args.tf}_ep{args.episodes}.csv", index=False)
    tr = res[res.split == "train"]
    tr_l = tr[tr.agent == "learned"].groupby(["year", "coin"]).ret.mean()
    tr_r = tr[tr.agent == "rules"].set_index(["year", "coin"]).ret
    print(f"\nTRAINING years (seen): learned beats rules {(tr_l > tr_r).sum()}/{len(tr_l)}, "
          f"avg 3-year return learned {tr_l.mean():+.0%} vs rules {tr_r.mean():+.0%}")
    te = res[(res.split == "test") & (res.agent == "learned")]
    print(f"WIN RATE (accuracy): training years {tr[tr.agent == 'learned'].win.mean():.0%}, "
          f"unseen years {te.win.mean():.0%}; avg trade training {tr[tr.agent == 'learned'].avg_r.mean():+.2f}R, "
          f"unseen {te.avg_r.mean():+.2f}R")
    res = res[res.split == "test"]

    # ---------- verdict ----------
    L = res[res.agent == "learned"].groupby(["year", "coin"]).agg(
        ret=("ret", "mean"), worst=("ret", "min"), best=("ret", "max"), per_bar=("per_bar", "mean"),
        exposure=("exposure", "mean"), trades=("trades", "mean"))
    R = res[res.agent == "rules"].set_index(["year", "coin"])
    H = res[res.agent == "hold"].set_index(["year", "coin"])
    t = L.join(R[["ret", "per_bar", "exposure", "trades"]], rsuffix="_rules").join(H[["ret"]].rename(columns={"ret": "hold"}))
    t["beats"] = t.ret > t.ret_rules
    t["beats_per_bar"] = t.per_bar > t.per_bar_rules
    t["worst_beats"] = t.worst > t.ret_rules

    show = pd.DataFrame({
        "hold": t.hold.map("{:+.0%}".format),
        "rules": t.ret_rules.map("{:+.1%}".format),
        "learned avg": t.ret.map("{:+.1%}".format),
        "worst..best": [f"{w:+.1%}..{b:+.1%}" for w, b in zip(t.worst, t.best)],
        "in mkt rules/learned": [f"{a:.0%}/{b:.0%}" for a, b in zip(t.exposure_rules, t.exposure)],
        "beats": t.beats.map({True: "yes", False: "no"}),
        "per-candle": t.beats_per_bar.map({True: "yes", False: "no"}),
    })
    pd.set_option("display.width", 200)
    print(f"\nWalk-forward, {args.tf} candles, {args.seeds} seeds, 1% risk per trade\n")
    print(show.to_string())
    n = len(t)
    c1, c2, c3 = t.beats.mean(), t.beats_per_bar.mean(), t.worst_beats.mean()
    print(f"\n1. average seed beats rules:        {t.beats.sum()}/{n} = {c1:.0%}  (need >= 75%)")
    print(f"2. beats rules per candle held:      {t.beats_per_bar.sum()}/{n} = {c2:.0%}  (need >= 75%)")
    print(f"3. worst seed beats rules:           {t.worst_beats.sum()}/{n} = {c3:.0%}  (need > 50%)")
    tot_l = (1 + t.ret).prod() - 1
    tot_r = (1 + t.ret_rules).prod() - 1
    print(f"   compounded over all tests: learned {tot_l:+.0%}, rules {tot_r:+.0%}")
    ok = c1 >= 0.75 and c2 >= 0.75 and c3 > 0.5
    print(f"\nVERDICT: {'learned agent RELIABLY beats the rules' if ok else 'NOT reliably better than the rules'}")


if __name__ == "__main__":
    main()

"""Two portfolio safety rules, each with a value fixed in advance (nothing to tune):

  1. BTC trend filter: open new trades only while BTC closed above its 200-day average the
     day before. Altcoins tend to fall when Bitcoin falls; this aims at years like 2022.
  2. Trade cap: never more than 5 trades open at once.

Each is compared with the current bot (10 coins, Breakout 20/10/2, 0.3% risk, one account)
from 2021 to now. A rule is adopted only if it passes all three, written down before running:
  A. higher return / worst-drop ratio     B. higher Sharpe     C. better in at least 4 of 6 years

    python safety_rules.py
"""
import numpy as np
import pandas as pd

import portfolio as pf
from strategies import ema
from tradingview_data import load_candles

RISK = 0.003
COINS = pf.BASKETS["10 coins"]


def btc_filter(sigs):
    btc = load_candles("BTC", "1d")[0]
    ok = btc.close > ema(btc.close, 200)  # known at each day's close; the entry is decided on that close
    out = {}
    for c, s in sigs.items():
        s = s.copy()
        s["entry"] = s["entry"] & ok.reindex(s.index).fillna(False).astype(bool)
        out[c] = s
    return out


def yearly(curve):
    ye = curve.resample("YE").last()
    first = ye.iloc[0] / curve.iloc[0] - 1
    r = ye.pct_change()
    r.iloc[0] = first
    return {d.year: v for d, v in r.items()}


def main():
    sigs = pf.prepare(COINS)
    variants = {
        "current bot": dict(sigs=sigs),
        "BTC trend filter": dict(sigs=btc_filter(sigs)),
        "max 5 open trades": dict(sigs=sigs, max_positions=5),
        "both": dict(sigs=btc_filter(sigs), max_positions=5),
    }
    res = {}
    for name, v in variants.items():
        curve, trades = pf.simulate(v["sigs"], start="2021-01-01", risk=RISK, max_positions=v.get("max_positions"))
        res[name] = dict(pf.stats(curve, trades), years=yearly(curve))

    print(f"10 coins, Breakout 20/10/2, {RISK:.1%} risk per trade, 2021 to now\n")
    print(f"{'':16}" + "".join(f"{n:>20}" for n in res))
    for key, label, fmt in [("total", "Total", "{:+.0%}"), ("cagr", "Per year", "{:+.1%}"), ("max_dd", "Worst drop", "{:+.1%}"),
                            ("ratio", "Return/drop", "{:.2f}"), ("sharpe", "Sharpe", "{:.2f}"), ("trades", "Trades", "{:d}")]:
        print(f"{label:16}" + "".join(f"{fmt.format(r[key]):>20}" for r in res.values()))
    print()
    for y in sorted(res["current bot"]["years"]):
        print(f"{y:<16}" + "".join(f"{r['years'][y]:>+20.1%}" for r in res.values()))

    base = res["current bot"]
    print()
    for name in list(res)[1:]:
        r = res[name]
        better = sum(r["years"][y] > base["years"][y] for y in base["years"])
        a, b, c = r["ratio"] > base["ratio"], r["sharpe"] > base["sharpe"], better >= 4
        print(f"{name:18} A {'pass' if a else 'FAIL'} ({r['ratio']:.2f} vs {base['ratio']:.2f})  "
              f"B {'pass' if b else 'FAIL'} ({r['sharpe']:.2f} vs {base['sharpe']:.2f})  "
              f"C {'pass' if c else 'FAIL'} ({better}/6)  ->  {'ADOPT' if a and b and c else 'reject'}")


if __name__ == "__main__":
    main()

"""Train the Breakout SETTINGS honestly: walk-forward selection on the 10-coin portfolio.

Settings tried (72 combinations):
  entry  N : buy on a close above the N-day high      10 15 20 30 40 55
  exit   M : sell on a close below the M-day low      5 10 15 20  (M < N)
  stop   K : stop-loss K x ATR(14) below the entry     1.5 2 3 4

Every combination is run as the live bot would trade it: 10 coins, one shared account,
0.3% risk per trade, fees, slippage, exchange stops (portfolio.simulate).

Walk-forward: for each year 2021-2026, pick the combination with the best Sharpe ratio over
the 3 years before, then trade that year with it. Stitch those unseen years together and
compare with the textbook 20 / 10 / 2 traded the same years.

Pass rules, written down before running:
  A. tuned has a higher return / worst-drop ratio than 20/10/2 on the unseen years
  B. tuned has a higher Sharpe ratio on the unseen years
  C. tuned is better in at least 4 of the 6 years

    python tune.py            # uses all but 2 processor cores
"""
import itertools
import os
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd

import portfolio as pf
from strategies import atr
from tradingview_data import load_candles

COINS = pf.BASKETS["10 coins"]
ENTRY, EXIT, STOP = [10, 15, 20, 30, 40, 55], [5, 10, 15, 20], [1.5, 2.0, 3.0, 4.0]
GRID = [(n, m, k) for n, m, k in itertools.product(ENTRY, EXIT, STOP) if m < n]
TEXTBOOK = (20, 10, 2.0)
RISK = 0.003
TEST_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
RESULTS = Path(__file__).parent / "results"

_data = {}


def _load():
    for c in COINS:
        _data[c] = load_candles(c, "1d")[0]


def breakout(df, n, m, k):
    out = df.copy()
    out["entry"] = df.close > df.high.rolling(n).max().shift()
    out["exit"] = df.close < df.low.rolling(m).min().shift()
    out["stop_dist"] = k * atr(df)
    return out[out.index >= out.index[0] + pd.Timedelta(days=220)]  # indicator warm-up


def run(params):
    if not _data:
        _load()
    sigs = {c: breakout(df, *params) for c, df in _data.items()}
    curve, trades = pf.simulate(sigs, start="2018-01-01", risk=RISK)
    return params, curve.pct_change().fillna(0.0), len(trades)


def sharpe(r):
    return r.mean() / r.std() * np.sqrt(365) if r.std() > 0 else -np.inf


def curve_stats(r):
    eq = (1 + r).cumprod()
    years = (r.index[-1] - r.index[0]).days / 365.25
    cagr = eq.iloc[-1] ** (1 / years) - 1
    dd = (eq / eq.cummax() - 1).min()
    return dict(total=eq.iloc[-1] - 1, cagr=cagr, max_dd=dd, ratio=cagr / -dd, sharpe=sharpe(r))


def main():
    workers = max(1, (os.cpu_count() or 4) - 2)
    print(f"running {len(GRID)} settings on {len(COINS)} coins with {workers} processes ...", flush=True)
    with Pool(workers, initializer=_load) as pool:
        runs = {p: (r, n) for p, r, n in pool.imap_unordered(run, GRID)}
    returns = pd.DataFrame({p: r for p, (r, _) in runs.items()})
    RESULTS.mkdir(exist_ok=True)

    # how good is every setting over the whole period? (shows whether 20/10/2 is a lucky peak)
    full = pd.DataFrame([dict(entry=p[0], exit=p[1], stop=p[2], trades=runs[p][1], **curve_stats(returns[p]))
                         for p in GRID]).sort_values("sharpe", ascending=False)
    full.to_csv(RESULTS / "tune_all_settings.csv", index=False)
    rank = full.reset_index(drop=True)
    tb = rank[(rank.entry == 20) & (rank.exit == 10) & (rank.stop == 2.0)]
    print(f"\nWhole period 2018-now: 20/10/2 ranks {tb.index[0] + 1} of {len(rank)} by Sharpe "
          f"({tb.sharpe.iloc[0]:.2f}; best {rank.sharpe.iloc[0]:.2f}, median {rank.sharpe.median():.2f})")
    print("Top 5:")
    for _, r in rank.head(5).iterrows():
        print(f"  {int(r.entry):>2}/{int(r.exit):>2}/{r.stop:<3}  sharpe {r.sharpe:.2f}  per year {r.cagr:+.1%}  worst drop {r.max_dd:+.1%}  trades {int(r.trades)}")

    # walk-forward selection
    picks, tuned, base = {}, [], []
    for y in TEST_YEARS:
        train = returns[(returns.index >= pd.Timestamp(f"{y - 3}-01-01", tz="UTC")) & (returns.index < pd.Timestamp(f"{y}-01-01", tz="UTC"))]
        test_mask = (returns.index >= pd.Timestamp(f"{y}-01-01", tz="UTC")) & (returns.index < pd.Timestamp(f"{y + 1}-01-01", tz="UTC"))
        best = max(GRID, key=lambda p: sharpe(train[p]))
        picks[y] = best
        tuned.append(returns.loc[test_mask, best])
        base.append(returns.loc[test_mask, TEXTBOOK])
    tuned, base = pd.concat(tuned), pd.concat(base)
    t, b = curve_stats(tuned), curve_stats(base)

    print(f"\nWalk-forward (settings picked on the 3 years before each test year, {RISK:.1%} risk, 10 coins):")
    print(f"  {'year':<6}{'picked':>12}{'tuned':>10}{'20/10/2':>10}")
    better = 0
    for y in TEST_YEARS:
        ty = (1 + tuned[tuned.index.year == y]).prod() - 1
        by = (1 + base[base.index.year == y]).prod() - 1
        better += ty > by
        n, m, k = picks[y]
        print(f"  {y:<6}{f'{n}/{m}/{k:g}':>12}{ty:>+10.1%}{by:>+10.1%}")
    print(f"\n  {'':16}{'tuned':>10}{'20/10/2':>10}")
    for key, label, fmt in [("total", "Total", "{:+.0%}"), ("cagr", "Per year", "{:+.1%}"), ("max_dd", "Worst drop", "{:+.1%}"),
                            ("ratio", "Return/drop", "{:.2f}"), ("sharpe", "Sharpe", "{:.2f}")]:
        print(f"  {label:16}{fmt.format(t[key]):>10}{fmt.format(b[key]):>10}")
    a, s, c = t["ratio"] > b["ratio"], t["sharpe"] > b["sharpe"], better >= 4
    print(f"\nA. return/drop {t['ratio']:.2f} vs {b['ratio']:.2f} -> {'pass' if a else 'FAIL'}")
    print(f"B. Sharpe      {t['sharpe']:.2f} vs {b['sharpe']:.2f} -> {'pass' if s else 'FAIL'}")
    print(f"C. better in {better} of {len(TEST_YEARS)} years -> {'pass' if c else 'FAIL'}")
    print(f"\nVERDICT: {'tuned settings BEAT 20/10/2 on unseen years' if a and s and c else 'tuning does NOT beat 20/10/2; keep the textbook settings'}")
    pd.DataFrame({"tuned": tuned, "textbook": base}).to_csv(RESULTS / "tune_walk_forward_returns.csv")


if __name__ == "__main__":
    main()

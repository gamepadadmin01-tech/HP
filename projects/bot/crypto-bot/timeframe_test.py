"""Daily vs 4-hour candles for the 10-coin Breakout bot (20/10/2, one account).

On 4-hour candles the same rules mean: buy on a close above the last 20 four-hour highs
(~3.3 days), sell below the last 10 four-hour lows. More trades, faster reactions, more fees.
Both are valued once a day so the comparison is fair. Pass rules, written down before running:
  A. higher return / worst-drop ratio   B. higher Sharpe   C. better in at least 4 of 6 years
and the same again after matching both to the same worst drop (risk per trade lowered).

    python timeframe_test.py
"""
import pandas as pd

import portfolio as pf
from strategies import donchian_breakout
from tradingview_data import load_candles

COINS = pf.BASKETS["10 coins"]


def prepare(tf):
    out = {}
    for c in COINS:
        sig = donchian_breakout(load_candles(c, tf)[0])
        out[c] = sig[sig.index >= sig.index[0] + pd.Timedelta(days=220)]
    return out


def daily(curve):
    return curve.resample("1D").last().dropna()


def yearly(curve):
    ye = curve.resample("YE").last()
    r = ye.pct_change()
    r.iloc[0] = ye.iloc[0] / curve.iloc[0] - 1
    return {d.year: v for d, v in r.items()}


def run(sigs, risk):
    curve, trades = pf.simulate(sigs, start="2021-01-01", risk=risk)
    curve = daily(curve)
    return dict(pf.stats(curve, trades), years=yearly(curve))


def show(title, d, h):
    print(f"\n{title}\n{'':14}{'daily':>12}{'4-hour':>12}")
    for key, label, fmt in [("cagr", "Per year", "{:+.1%}"), ("max_dd", "Worst drop", "{:+.1%}"),
                            ("ratio", "Return/drop", "{:.2f}"), ("sharpe", "Sharpe", "{:.2f}"), ("trades", "Trades", "{:d}")]:
        print(f"{label:14}{fmt.format(d[key]):>12}{fmt.format(h[key]):>12}")
    for y in sorted(d["years"]):
        print(f"{y:<14}{d['years'][y]:>+12.1%}{h['years'].get(y, float('nan')):>+12.1%}")
    better = sum(h["years"].get(y, -1) > d["years"][y] for y in d["years"])
    a, b, c = h["ratio"] > d["ratio"], h["sharpe"] > d["sharpe"], better >= 4
    print(f"A {'pass' if a else 'FAIL'}  B {'pass' if b else 'FAIL'}  C {'pass' if c else 'FAIL'} ({better}/6)"
          f"  ->  4-hour {'BETTER' if a and b and c else 'not better'}")
    return a and b and c


def main():
    d_sigs, h_sigs = prepare("1d"), prepare("4h")
    d = run(d_sigs, 0.003)
    h = run(h_sigs, 0.003)
    ok1 = show("Same risk per trade (0.3%)", d, h)
    # match the 4-hour worst drop to the daily one by scaling its risk per trade
    risk = 0.003
    for _ in range(6):
        risk *= d["max_dd"] / h["max_dd"]
        h = run(h_sigs, risk)
    ok2 = show(f"Same worst drop (4-hour at {risk:.2%} risk per trade)", d, h)
    print(f"\nVERDICT: {'switch to 4-hour candles' if ok1 and ok2 else 'stay on daily candles'}")


if __name__ == "__main__":
    main()

"""Breakout rules on many coins at once, sharing ONE account.

Same rules and fills as backtest.py (decide at the close, fill at the next open, stop checked
against each day's low, 0.1% fee + 0.05% slippage per fill), but every coin trades from the
same pot of money:
  * each new trade risks RISK of the account's current value between entry and stop
  * a trade only gets the cash that is actually free; if several coins signal on the same
    day they are filled in order until the cash runs out
  * a coin whose data stops (delisted) is sold at its last price

Compared, from 2021 to now:
  BTC+ETH   vs   10 coins   vs   10 coins + 10 that crashed (survivorship check)

Pass rules, written down before running:
  A. 10 coins has a higher return-to-worst-drop ratio than BTC+ETH
  B. 10 coins has a higher Sharpe ratio (daily returns)
  C. 10 coins does better in at least 4 of the 6 years
  D. 10 + crashed coins still beats BTC+ETH on A

    python portfolio.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

from strategies import donchian_breakout
from tradingview_data import load_candles

FEE, SLIP = 0.001, 0.0005
RISK = 0.01
START = "2021-01-01"
RESULTS = Path(__file__).parent / "results"

BASKETS = {
    "BTC+ETH": ["BTC", "ETH"],
    "10 coins": ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "LTC", "LINK", "AVAX"],
}
CRASHED = ["FTT", "LUNC", "EOS", "FIL", "ICP", "SAND", "XLM", "ETC", "MATIC", "POL"]
BASKETS["10 + 10 crashed"] = BASKETS["10 coins"] + CRASHED


def prepare(coins):
    """Signals per coin, computed on each coin's full history (only past data is used per day)."""
    out = {}
    for c in coins:
        df, _ = load_candles(c, "1d")
        sig = donchian_breakout(df)
        sig = sig[sig.index >= sig.index[0] + pd.Timedelta(days=220)]  # indicator warm-up
        out[c] = sig
    return out


def simulate(sigs, start=START, end=None, risk=RISK, start_equity=10_000.0, max_positions=None):
    """max_positions: if set, no new trade opens while that many are already open."""
    days = sorted(set().union(*[s.index for s in sigs.values()]))
    days = [d for d in days if d >= pd.Timestamp(start, tz="UTC") and (end is None or d <= pd.Timestamp(end, tz="UTC"))]
    last_day = {c: s.index[-1] for c, s in sigs.items()}
    cash, pos, trades, equity = start_equity, {}, [], []
    prev_close = {}

    def sell(c, px, day, reason):
        nonlocal cash
        p = pos.pop(c)
        exit_px = px * (1 - SLIP)
        cash += p["units"] * exit_px * (1 - FEE)
        trades.append(dict(coin=c, entry_time=p["day"], exit_time=day, reason=reason,
                           ret=exit_px * (1 - FEE) / (p["entry"] * (1 + FEE)) - 1,
                           r=(exit_px * (1 - FEE) - p["entry"] * (1 + FEE)) / p["risk"]))

    for k, day in enumerate(days):
        prev = days[k - 1] if k else None
        # 1) exits decided at yesterday's close, filled at today's open
        for c in list(pos):
            s = sigs[c]
            if day in s.index and prev in s.index and s.at[prev, "exit"]:
                sell(c, s.at[day, "open"], day, "10-day low")
        # 2) entries decided at yesterday's close; size from yesterday's account value
        eq_prev = equity[-1] if equity else start_equity
        for c, s in sigs.items():
            if c in pos or day not in s.index or prev not in s.index:
                continue
            if max_positions and len(pos) >= max_positions:
                break
            if s.at[prev, "entry"] and np.isfinite(s.at[prev, "stop_dist"]):
                entry = s.at[day, "open"] * (1 + SLIP)
                dist = s.at[prev, "stop_dist"]
                value = min(eq_prev * risk / (dist / entry), cash / (1 + FEE))
                if value < 10:  # out of cash
                    continue
                units = value / entry
                cash -= units * entry * (1 + FEE)
                pos[c] = dict(units=units, entry=entry, stop=entry - dist, risk=dist, day=day)
        # 3) stops during the day
        for c in list(pos):
            s = sigs[c]
            if day not in s.index:
                continue
            o, l = s.at[day, "open"], s.at[day, "low"]
            if o <= pos[c]["stop"]:
                sell(c, o, day, "stop (gap)")
            elif l <= pos[c]["stop"]:
                sell(c, pos[c]["stop"], day, "stop")
        # 4) delisted coins: sell at the last price there is
        for c in list(pos):
            if day >= last_day[c]:
                sell(c, sigs[c].close.iloc[-1], day, "data ended")
        # 5) value the account at the close
        for c, s in sigs.items():
            if day in s.index:
                prev_close[c] = s.at[day, "close"]
        equity.append(cash + sum(p["units"] * prev_close[c] for c, p in pos.items()))
    curve = pd.Series(equity, index=pd.DatetimeIndex(days))
    return curve, pd.DataFrame(trades)


def stats(curve, trades):
    years = (curve.index[-1] - curve.index[0]).days / 365.25
    cagr = (curve.iloc[-1] / curve.iloc[0]) ** (1 / years) - 1
    dd = (curve / curve.cummax() - 1).min()
    daily = curve.pct_change().dropna()
    yearly = curve.resample("YE").last().pct_change()
    yearly.iloc[0] = curve.resample("YE").last().iloc[0] / curve.iloc[0] - 1
    return dict(total=curve.iloc[-1] / curve.iloc[0] - 1, cagr=cagr, max_dd=dd, ratio=cagr / -dd if dd < 0 else np.nan,
                sharpe=daily.mean() / daily.std() * np.sqrt(365), trades=len(trades),
                win=(trades.r > 0).mean() if len(trades) else np.nan,
                yearly={d.year: v for d, v in yearly.items()})


def main():
    results = {}
    for name, coins in BASKETS.items():
        sigs = prepare(coins)
        curve, trades = simulate(sigs)
        results[name] = stats(curve, trades)
        curve.to_csv(RESULTS / f"portfolio_{name.replace(' ', '_').replace('+', 'plus')}.csv", header=["equity"])
        print(f"{name}: {len(coins)} coins simulated, {len(trades)} trades")

    print(f"\nShared account, Breakout rules, {RISK:.0%} risk per trade, {START} to now\n")
    head = f"{'':16}" + "".join(f"{n:>18}" for n in results)
    print(head)
    for key, label, fmt in [("total", "Total return", "{:+.0%}"), ("cagr", "Per year", "{:+.1%}"),
                            ("max_dd", "Worst drop", "{:+.1%}"), ("ratio", "Return / drop", "{:.2f}"),
                            ("sharpe", "Sharpe", "{:.2f}"), ("trades", "Trades", "{:d}"), ("win", "Win rate", "{:.0%}")]:
        print(f"{label:16}" + "".join(f"{fmt.format(r[key]):>18}" for r in results.values()))
    print()
    for y in sorted(results["BTC+ETH"]["yearly"]):
        print(f"{y:<16}" + "".join(f"{r['yearly'].get(y, np.nan):>+18.1%}" for r in results.values()))

    b, t, s = results["BTC+ETH"], results["10 coins"], results["10 + 10 crashed"]
    yrs = sorted(b["yearly"])
    better_years = sum(t["yearly"][y] > b["yearly"][y] for y in yrs)
    a, bb, c, d = t["ratio"] > b["ratio"], t["sharpe"] > b["sharpe"], better_years >= 4, s["ratio"] > b["ratio"]
    print(f"\nA. return/drop, 10 coins vs BTC+ETH:   {t['ratio']:.2f} vs {b['ratio']:.2f}  -> {'pass' if a else 'FAIL'}")
    print(f"B. Sharpe, 10 coins vs BTC+ETH:        {t['sharpe']:.2f} vs {b['sharpe']:.2f}  -> {'pass' if bb else 'FAIL'}")
    print(f"C. years where 10 coins did better:    {better_years} of {len(yrs)}  -> {'pass' if c else 'FAIL'}")
    print(f"D. with crashed coins, return/drop:    {s['ratio']:.2f} vs {b['ratio']:.2f}  -> {'pass' if d else 'FAIL'}")
    print(f"\nVERDICT: {'10 coins IS better than BTC+ETH alone' if a and bb and c and d else '10 coins is NOT reliably better than BTC+ETH alone'}")


if __name__ == "__main__":
    main()

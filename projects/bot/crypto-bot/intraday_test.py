"""Can the 10-coin Breakout bot trade faster? Daily vs 1-hour, 30-minute and 15-minute candles.

Same rules on every timeframe, counted in candles: buy on a close above the last 20 highs,
sell on a close below the last 10 lows, stop 2 x ATR(14) below the entry. On 15-minute candles
that is a 5-hour high, so trades are short (intraday / scalping style). Same 10 coins, one
account, 0.3% risk per trade, slippage 0.05% per fill, exchange stops.

Fees decide whether fast trading can work, so each timeframe runs twice:
  0.100% per fill (Binance standard)   and   0.075% per fill (fees paid in BNB)

Pass rules vs the daily bot, 2021-03 to now, written down before running:
  A. higher return / worst-drop ratio   B. higher Sharpe   C. better in at least 4 of 6 years

    python intraday_test.py          # needs data/<COIN>USDT_{1h,30m,15m}.csv (2021 onwards)
"""
import os
from multiprocessing import Pool

import pandas as pd

import portfolio as pf
from strategies import donchian_breakout
from timeframe_test import daily, yearly
from tradingview_data import load_candles

COINS = pf.BASKETS["10 coins"]
START = "2021-03-01"
TIMEFRAMES = ["1d", "1h", "30m", "15m"]
FEES = [0.001, 0.00075]


def run(job):
    tf, fee = job
    pf.FEE = fee
    sigs = {}
    for c in COINS:
        sig = donchian_breakout(load_candles(c, tf)[0])
        sigs[c] = sig.iloc[250:]  # warm-up: enough candles for the indicators on any timeframe
    curve, trades = pf.simulate(sigs, start=START, risk=0.003)
    curve = daily(curve)
    hold = pd.DataFrame(trades)
    avg_hours = ((hold.exit_time - hold.entry_time).dt.total_seconds().mean() / 3600) if len(hold) else 0
    return job, dict(pf.stats(curve, trades), years=yearly(curve), avg_hours=avg_hours,
                     fee_share=len(trades) * 2 * fee)


def main():
    jobs = [(tf, fee) for tf in TIMEFRAMES for fee in FEES]
    with Pool(min(len(jobs), max(1, (os.cpu_count() or 4) - 2))) as pool:
        res = dict(pool.map(run, jobs))

    print(f"10 coins, Breakout 20/10/2 counted in candles, 0.3% risk per trade, {START} to now\n")
    for fee in FEES:
        print(f"Fee {fee:.3%} per fill")
        print(f"{'':16}" + "".join(f"{tf:>12}" for tf in TIMEFRAMES))
        rows = [("cagr", "Per year", "{:+.1%}"), ("max_dd", "Worst drop", "{:+.1%}"), ("ratio", "Return/drop", "{:.2f}"),
                ("sharpe", "Sharpe", "{:.2f}"), ("trades", "Trades", "{:,d}"), ("win", "Win rate", "{:.0%}"),
                ("avg_hours", "Avg hold (h)", "{:.0f}")]
        for key, label, fmt in rows:
            print(f"{label:16}" + "".join(f"{fmt.format(res[(tf, fee)][key]):>12}" for tf in TIMEFRAMES))
        for y in sorted(res[("1d", fee)]["years"]):
            print(f"{y:<16}" + "".join(f"{res[(tf, fee)]['years'].get(y, float('nan')):>+12.1%}" for tf in TIMEFRAMES))
        base = res[("1d", fee)]
        for tf in TIMEFRAMES[1:]:
            r = res[(tf, fee)]
            better = sum(r["years"].get(y, -9) > base["years"][y] for y in base["years"])
            a, b, c = r["ratio"] > base["ratio"], r["sharpe"] > base["sharpe"], better >= 4
            print(f"  {tf:>4} vs daily: A {'pass' if a else 'FAIL'}  B {'pass' if b else 'FAIL'}  C {'pass' if c else 'FAIL'} "
                  f"({better}/{len(base['years'])})  ->  {'BETTER than daily' if a and b and c else 'not better'}")
        print()


if __name__ == "__main__":
    main()

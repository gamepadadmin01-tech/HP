"""Backtest every strategy on BTC and ETH daily candles.

Indicators are computed on the full history, then each period is simulated
separately, so the 2023+ results are an out-of-sample check: the rules and
parameters were fixed without looking at that period.

    python run_backtests.py      # writes results/summary.csv and results/trades_*.csv
"""
from pathlib import Path

import pandas as pd

from backtest import buy_and_hold, run, stats
from strategies import STRATEGIES

DATA = Path(__file__).parent / "data"
RESULTS = Path(__file__).parent / "results"
COINS = ["BTCUSDT", "ETHUSDT"]
PERIODS = {
    "2018-2022 (in-sample)": ("2018-01-01", "2022-12-31"),
    "2023-now (out-of-sample)": ("2023-01-01", None),
    "Full 2018-now": ("2018-01-01", None),
}
SIZING = {"2% risk": 0.02, "All-in": 1.0}


def load(coin, tf="1d"):
    return pd.read_csv(DATA / f"{coin}_{tf}.csv", index_col="time", parse_dates=True)


def main():
    RESULTS.mkdir(exist_ok=True)
    rows, curves = [], {}
    for coin in COINS:
        df = load(coin)
        for pname, (a, b) in PERIODS.items():
            part = df.loc[a:b]
            bh = buy_and_hold(part)
            rows.append(dict(coin=coin, period=pname, strategy="Buy & hold", sizing="-",
                             **stats(bh, pd.DataFrame(columns=["ret"]))))
            curves[(coin, pname, "Buy & hold")] = bh
            for sname, fn in STRATEGIES.items():
                sig = fn(df).loc[a:b]
                for zname, risk in SIZING.items():
                    eq, trades = run(sig, risk)
                    rows.append(dict(coin=coin, period=pname, strategy=sname, sizing=zname, **stats(eq, trades)))
                    if zname == "All-in":
                        curves[(coin, pname, sname)] = eq
                        if pname.startswith("Full"):
                            trades.to_csv(RESULTS / f"trades_{coin}_{fn.__name__}.csv", index=False)
    summary = pd.DataFrame(rows)
    summary.loc[summary.strategy == "Buy & hold", ["Trades", "Win rate", "Avg win", "Avg loss", "Profit factor"]] = None
    summary.to_csv(RESULTS / "summary.csv", index=False)
    pd.to_pickle(curves, RESULTS / "curves.pkl")
    return summary


if __name__ == "__main__":
    s = main()
    pd.set_option("display.width", 220, "display.max_columns", 20)
    fmt = s.copy()
    for col in ["Total return", "CAGR", "Max drawdown", "Win rate", "Avg win", "Avg loss"]:
        fmt[col] = fmt[col].map(lambda v: "" if pd.isna(v) else f"{v:+.0%}" if col != "Win rate" else f"{v:.0%}")
    for col in ["Sharpe", "Profit factor"]:
        fmt[col] = fmt[col].map(lambda v: "" if pd.isna(v) else f"{v:.2f}")
    print(fmt.to_string(index=False))

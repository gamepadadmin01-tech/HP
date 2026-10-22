"""Today's signals: what each strategy says right now, with entry and stop levels.

Pulls fresh daily candles, drops today's unfinished candle, and replays each
strategy over the history to see whether it is currently in a trade.

    python signals.py                         # $1,000 account, 1% risk per trade
    python signals.py --account 5000 --risk 0.02

This prints what the rules say. It is not advice: check the backtest
results first, and paper trade before risking real money.
"""
import argparse

import pandas as pd

from backtest import run
from fetch_data import binance
from strategies import STRATEGIES, atr, ema, rsi, sma

COINS = ["BTC/USDT", "ETH/USDT"]


def candles(ex, symbol, n=1000):
    rows = ex.fetch_ohlcv(symbol, "1d", limit=n)
    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    df = df.set_index("time")
    return df.iloc[:-1]  # last candle is still forming


def watch_levels(fn_name, df):
    """Plain-English description of what would trigger the next entry."""
    c = df.close
    if fn_name == "trend_ema":
        f, s, t = ema(c, 20).iloc[-1], ema(c, 50).iloc[-1], ema(c, 200).iloc[-1]
        trend = "above" if c.iloc[-1] > t else "below"
        if f > s:
            note = ("EMA20 is already above EMA50 but this move was missed or stopped out; "
                    "it only buys on a fresh cross, so wait for EMA20 to dip under EMA50 and cross back up.")
        else:
            note = "Buy when EMA20 crosses above EMA50 with price above EMA200."
        return f"EMA20 {f:,.0f} vs EMA50 {s:,.0f}; price is {trend} EMA200 ({t:,.0f}). {note}"
    if fn_name == "donchian_breakout":
        return f"Buy if a daily candle closes above {df.high.tail(20).max():,.2f} (20-day high)."
    if fn_name == "rsi_pullback":
        r, m = rsi(c).iloc[-1], sma(c, 200).iloc[-1]
        trend = "above" if c.iloc[-1] > m else "below (no dip-buys allowed)"
        return f"RSI {r:.0f}; price is {trend} SMA200 ({m:,.0f}). Buy when RSI falls below 40 in an uptrend."
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", type=float, default=1000.0, help="account size in USDT")
    ap.add_argument("--risk", type=float, default=0.01, help="fraction of account to lose if stopped out")
    args = ap.parse_args()

    ex = binance(mirror=True)
    peg = candles(ex, "USDC/USDT", 30).close
    print(f"USDC/USDT peg: last {peg.iloc[-1]:.4f}, 30-day range {peg.min():.4f}-{peg.max():.4f}\n")

    for symbol in COINS:
        df = candles(ex, symbol)
        last = df.index[-1].date()
        px, a = df.close.iloc[-1], atr(df).iloc[-1]
        print(f"=== {symbol}  close {px:,.2f} on {last}  (ATR {a:,.0f} = {a / px:.1%} daily range)")
        for name, fn in STRATEGIES.items():
            sig = fn(df)
            _, trades = run(sig, 1.0)
            open_trade = trades.iloc[-1] if len(trades) and trades.iloc[-1].reason == "open" else None
            if sig.entry.iloc[-1] and open_trade is None:
                stop = px - sig.stop_dist.iloc[-1]
                units = args.account * args.risk / (px - stop)
                units = min(units, args.account / px)
                print(f"  [BUY SIGNAL] {name}\n"
                      f"      buy at next open (~{px:,.2f}), stop-loss {stop:,.2f} ({stop / px - 1:.1%})\n"
                      f"      size for ${args.account:,.0f} @ {args.risk:.0%} risk: {units:.6f} "
                      f"(~${units * px:,.0f})")
            elif open_trade is not None:
                action = "SELL at next open" if sig.exit.iloc[-1] else "hold"
                print(f"  [IN TRADE]   {name}\n"
                      f"      entered {open_trade.entry_time.date()} at {open_trade.entry:,.2f} "
                      f"({px / open_trade.entry - 1:+.1%}); stop-loss now {open_trade.stop:,.2f} -> {action}")
            else:
                print(f"  [WAIT]       {name}\n      {watch_levels(fn.__name__, df)}")
        print()


if __name__ == "__main__":
    main()

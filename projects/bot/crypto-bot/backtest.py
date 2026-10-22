"""Bar-by-bar backtester for the long-only strategies in strategies.py.

Rules of the simulation:
  * signals are read at a bar's close and filled at the NEXT bar's open
  * stop-losses are checked against each bar's low; a gap below the stop
    fills at the open, otherwise at the stop price
  * every fill pays FEE + SLIPPAGE (Binance spot taker fee is 0.1%)
  * position size risks RISK of equity between entry and stop, capped at
    100% of equity (no leverage). RISK = 1.0 means "all-in" every trade.
"""
import numpy as np
import pandas as pd

FEE = 0.001
SLIPPAGE = 0.0005
START_EQUITY = 10_000.0


def run(sig, risk=0.02):
    o, h, l, c = (sig[k].to_numpy() for k in ("open", "high", "low", "close"))
    entry, exit_ = sig["entry"].to_numpy(), sig["exit"].to_numpy()
    stop_dist = sig["stop_dist"].to_numpy()
    trail = sig["trail_mult"].to_numpy() if "trail_mult" in sig else np.full(len(sig), np.nan)
    max_bars = int(sig["max_bars"].iloc[0]) if "max_bars" in sig else None
    atr_unit = stop_dist / np.where(np.isnan(trail), 1, trail)  # ATR when a trail is used

    cash, units, stop, entry_px, peak, held = START_EQUITY, 0.0, 0.0, 0.0, 0.0, 0
    equity, trades = np.empty(len(sig)), []
    entry_time = None

    def sell(i, px, reason):
        nonlocal cash, units
        px *= 1 - SLIPPAGE
        cash += units * px * (1 - FEE)
        trades.append(dict(entry_time=entry_time, exit_time=sig.index[i], entry=entry_px, exit=px,
                           ret=px * (1 - FEE) / (entry_px * (1 + FEE)) - 1, bars=held, reason=reason))
        units = 0.0

    for i in range(len(sig)):
        if i > 0 and units == 0 and entry[i - 1] and not np.isnan(stop_dist[i - 1]):
            entry_px = o[i] * (1 + SLIPPAGE)
            stop = entry_px - stop_dist[i - 1]
            eq = cash
            size_val = min(eq * risk / (stop_dist[i - 1] / entry_px), eq / (1 + FEE))
            units = size_val / entry_px
            cash -= units * entry_px * (1 + FEE)
            peak, held, entry_time = c[i - 1], 0, sig.index[i]
        elif i > 0 and units > 0:
            held += 1
            if exit_[i - 1] or (max_bars and held > max_bars):
                sell(i, o[i], "signal" if exit_[i - 1] else "time")
        if units > 0:
            if o[i] <= stop:
                sell(i, o[i], "stop (gap)")
            elif l[i] <= stop:
                sell(i, stop, "stop")
        if units > 0:
            peak = max(peak, c[i])
            if not np.isnan(trail[i]):
                stop = max(stop, peak - trail[i] * atr_unit[i])
        equity[i] = cash + units * c[i]

    if units > 0:  # mark open trade at the last close for the stats
        trades.append(dict(entry_time=entry_time, exit_time=sig.index[-1], entry=entry_px, exit=c[-1],
                           ret=c[-1] / entry_px - 1, bars=held, reason="open", stop=stop))
    return pd.Series(equity, index=sig.index), pd.DataFrame(trades)


def stats(equity, trades):
    years = (equity.index[-1] - equity.index[0]).days / 365.25
    daily = equity.pct_change().dropna()
    dd = equity / equity.cummax() - 1
    if len(trades):
        wins, losses = trades[trades.ret > 0], trades[trades.ret <= 0]
    else:
        wins = losses = pd.DataFrame(columns=["ret"])
    return {
        "Total return": equity.iloc[-1] / equity.iloc[0] - 1,
        "CAGR": (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1 if years > 0 else np.nan,
        "Max drawdown": dd.min(),
        "Sharpe": daily.mean() / daily.std() * np.sqrt(365) if daily.std() > 0 else np.nan,
        "Trades": len(trades),
        "Win rate": len(wins) / len(trades) if len(trades) else np.nan,
        "Avg win": wins.ret.mean() if len(wins) else np.nan,
        "Avg loss": losses.ret.mean() if len(losses) else np.nan,
        "Profit factor": wins.ret.sum() / -losses.ret.sum() if len(losses) and losses.ret.sum() < 0 else np.nan,
    }


def buy_and_hold(df):
    return START_EQUITY * df["close"] / df["open"].iloc[0]

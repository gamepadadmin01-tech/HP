"""Rule-based long-only strategies for spot crypto.

Each strategy adds three columns to a candle DataFrame, all computed from
data available at the close of that bar (no look-ahead):

    entry       True on the bar whose close triggers a buy (filled next open)
    exit        True on the bar whose close triggers a sell (filled next open)
    stop_dist   distance from entry price to the initial stop-loss

Parameters are textbook defaults, deliberately not tuned to this data.
"""
import numpy as np
import pandas as pd


# ---------- indicators ----------

def ema(s, n):
    return s.ewm(span=n, adjust=False).mean()


def sma(s, n):
    return s.rolling(n).mean()


def atr(df, n=14):
    prev = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def rsi(s, n=14):
    d = s.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    down = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / down)


def crossed_above(a, b):
    return (a > b) & (a.shift() <= b.shift())


def crossed_below(a, b):
    return (a < b) & (a.shift() >= b.shift())


# ---------- strategies ----------

def trend_ema(df):
    """Trend following: ride big moves, sit out bear markets.

    Entry : EMA 20 crosses above EMA 50 while price is above EMA 200.
    Exit  : EMA 20 crosses below EMA 50 (or the trailing stop is hit).
    Stop  : 3 x ATR below entry, trailed 3 x ATR below the highest close.
    """
    out = df.copy()
    f, s, t = ema(df.close, 20), ema(df.close, 50), ema(df.close, 200)
    out["entry"] = crossed_above(f, s) & (df.close > t)
    out["exit"] = crossed_below(f, s)
    out["stop_dist"] = 3 * atr(df)
    out["trail_mult"] = 3.0
    return out


def donchian_breakout(df):
    """Turtle-style breakout: buy new highs, sell when the move fails.

    Entry : close above the highest high of the previous 20 days.
    Exit  : close below the lowest low of the previous 10 days.
    Stop  : 2 x ATR below entry.
    """
    out = df.copy()
    hi20 = df.high.rolling(20).max().shift()
    lo10 = df.low.rolling(10).min().shift()
    out["entry"] = df.close > hi20
    out["exit"] = df.close < lo10
    out["stop_dist"] = 2 * atr(df)
    out["trail_mult"] = np.nan
    return out


def rsi_pullback(df):
    """Buy the dip inside an uptrend.

    Entry : price above SMA 200 and RSI(14) drops below 40.
    Exit  : RSI(14) rises above 65, or after 15 bars.
    Stop  : 2.5 x ATR below entry.
    """
    out = df.copy()
    r = rsi(df.close)
    out["entry"] = (df.close > sma(df.close, 200)) & crossed_below(r, pd.Series(40.0, index=df.index))
    out["exit"] = r > 65
    out["stop_dist"] = 2.5 * atr(df)
    out["trail_mult"] = np.nan
    out["max_bars"] = 15
    return out


STRATEGIES = {
    "Trend (EMA 20/50 + 200 filter)": trend_ema,
    "Breakout (Donchian 20/10)": donchian_breakout,
    "Dip-buy (RSI pullback in uptrend)": rsi_pullback,
}

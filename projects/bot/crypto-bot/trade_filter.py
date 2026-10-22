"""Training bot v2: learns which Breakout trades to TAKE and which to SKIP.

The Breakout rule still finds the trades and still decides when to sell (close below the
10-day low, or the 2 x ATR stop). The bot only answers one question each time the rule says
"buy": take it, or skip it?

How it learns (reward and penalty):
  * every past Breakout trade is a lesson; its reward is the result in R
    (profit / amount risked): +2R for a good trade, about -1R for one that hit its stop
  * the reward is credited to the market SITUATION the trade started in
    (uptrend or not, momentum, overbought, volatile, volume surge)
  * a situation is skipped only when it has clearly lost money over many trades. It starts
    from the average Breakout result and needs enough evidence to move away from it, so a
    couple of lucky or unlucky trades change nothing ("don't trust luck")
  * it learns from 10 coins, so every situation has many more lessons behind it

Walk-forward test: for each year 2021-2026 it learns from the 3 years before (all 10 coins)
and is tested on that year, which it has never seen, against the plain Breakout rules.

    python trade_filter.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

from strategies import atr, donchian_breakout, ema, rsi
from tradingview_data import load_candles

COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "LTC", "LINK", "AVAX"]
TEST_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN_YEARS = 3
FEE, SLIP = 0.001, 0.0005
PRIOR = 10        # lessons' worth of trust in the average before a situation can stand on its own
RESULTS = Path(__file__).parent / "results"

SITUATION = [  # (column, what 1 means, what 0 means)
    ("trend", "price above its 200-day average", "price below its 200-day average"),
    ("momentum", "higher than 4 weeks ago", "lower than 4 weeks ago"),
    ("hot", "RSI above 70 (overbought)", "RSI 70 or below"),
    ("wild", "volatility above normal", "volatility normal or low"),
    ("volume", "volume 1.5x its 20-day average", "ordinary volume"),
]


def situations(df):
    """One situation code per day, e.g. '10110', using only data up to that day's close."""
    c = df.close
    a = atr(df)
    flags = pd.DataFrame({
        "trend": c > ema(c, 200),
        "momentum": c > c.shift(28),
        "hot": rsi(c) > 70,
        "wild": (a / c) > (a / c).rolling(100).median(),
        "volume": df.volume > 1.5 * df.volume.rolling(20).mean(),
    }, index=df.index).astype(int)
    return flags.astype(str).agg("".join, axis=1)


def describe(code):
    return "; ".join(yes if bit == "1" else no for bit, (_, yes, no) in zip(code, SITUATION))


class Coin:
    def __init__(self, name, df):
        sig = donchian_breakout(df)
        self.name, self.index = name, df.index
        self.o, self.l, self.c = df.open.to_numpy(), df.low.to_numpy(), df.close.to_numpy()
        self.entry, self.exit = sig.entry.to_numpy(), sig.exit.to_numpy()
        self.stop_dist = sig.stop_dist.to_numpy()
        self.code = situations(df).to_numpy()
        self.first = 220  # skip the indicator warm-up

    def bars(self, start, end):
        i0 = max(self.first, int(np.searchsorted(self.index, pd.Timestamp(start, tz="UTC"))))
        i1 = int(np.searchsorted(self.index, pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1))) - 1
        return i0, min(i1, len(self.c) - 1)

    def trade(self, take, start="2018-01-01", end="2100-01-01"):
        """Breakout trades between start and end; take(code) decides each buy signal.

        Same fill rules as backtest.py: decide at the close, fill at the next open,
        stop checked against each day's low. A trade open at `end` is closed there.
        """
        i0, i1 = self.bars(start, end)
        trades, pos = [], None
        for i in range(i0, i1):
            nxt = i + 1
            if pos is None and self.entry[i] and np.isfinite(self.stop_dist[i]) and take(self.code[i]):
                px = self.o[nxt] * (1 + SLIP)
                pos = dict(entry=px, risk=self.stop_dist[i], stop=px - self.stop_dist[i], code=self.code[i], start=nxt)
            elif pos is not None and self.exit[i]:
                trades.append(self._close(pos, self.o[nxt], nxt, "10-day low")); pos = None
            if pos is not None and (self.o[nxt] <= pos["stop"] or self.l[nxt] <= pos["stop"]):
                trades.append(self._close(pos, min(self.o[nxt], pos["stop"]), nxt, "stop")); pos = None
        if pos is not None:
            trades.append(self._close(pos, self.c[i1], i1, "period end"))
        return trades, i1 - i0 + 1

    def _close(self, pos, px, i, reason):
        exit_px = px * (1 - SLIP)
        r = (exit_px * (1 - FEE) - pos["entry"] * (1 + FEE)) / pos["risk"]
        return dict(coin=self.name, code=pos["code"], entry_time=self.index[pos["start"]], exit_time=self.index[i],
                    r=r, bars=i - pos["start"], reason=reason)


def learn(lessons):
    """Reward table: for each situation, how its trades turned out, shrunk toward the average."""
    base = lessons.r.mean()
    t = lessons.groupby("code").r.agg(n="count", total="sum", avg="mean")
    t["score"] = (t.total + PRIOR * base) / (t.n + PRIOR)   # needs many lessons to move far from `base`
    t["keep"] = t.score > 0
    return t, base


def policy(table):
    skip = set(table.index[~table.keep])
    return lambda code: code not in skip   # unseen situations: trust the Breakout rule


def score(trades, n_bars):
    t = pd.DataFrame(trades)
    if t.empty:
        return dict(trades=0, win=np.nan, avg_r=np.nan, total_r=0.0, ret=0.0, exposure=0.0)
    return dict(trades=len(t), win=(t.r > 0).mean(), avg_r=t.r.mean(), total_r=t.r.sum(),
                ret=(1 + 0.01 * t.r).prod() - 1, exposure=t.bars.sum() / n_bars)


def main():
    coins = {}
    for name in COINS:
        df, source = load_candles(name, "1d")
        coins[name] = Coin(name, df)
        print(f"{name:5} {len(df):5} days from {source}")

    every = pd.DataFrame([t for c in coins.values() for t in c.trade(lambda code: True)[0]])
    rows, tables = [], {}
    for year in TEST_YEARS:
        y0 = pd.Timestamp(f"{year}-01-01", tz="UTC")
        lessons = every[(every.entry_time >= y0 - pd.DateOffset(years=TRAIN_YEARS)) & (every.exit_time < y0)]
        table, base = learn(lessons)
        tables[year] = table
        take = policy(table)
        for name, coin in coins.items():
            if coin.index[coin.first] > y0:  # coin too new to have a full test year
                continue
            r_tr, n = coin.trade(lambda code: True, f"{year}-01-01", f"{year}-12-31")
            f_tr, _ = coin.trade(take, f"{year}-01-01", f"{year}-12-31")
            rows.append(dict(year=year, coin=name, agent="rules", **score(r_tr, n)))
            rows.append(dict(year=year, coin=name, agent="filter", **score(f_tr, n)))
        skipped = table[~table.keep]
        print(f"{year}: learned from {len(lessons)} trades ({lessons.coin.nunique()} coins), "
              f"avg {base:+.2f}R; skips {len(skipped)} of {len(table)} situations")

    res = pd.DataFrame(rows)
    RESULTS.mkdir(exist_ok=True)
    res.to_csv(RESULTS / "trade_filter_walk_forward.csv", index=False)
    w = res.pivot_table(index=["year", "coin"], columns="agent", values=["ret", "total_r", "trades", "exposure"])

    # ---------- verdict (rules fixed before running) ----------
    diff = w["ret"]["filter"] - w["ret"]["rules"]
    wins, losses, ties = int((diff > 1e-9).sum()), int((diff < -1e-9).sum()), int((diff.abs() <= 1e-9).sum())
    comp_f, comp_r = (1 + w["ret"]["filter"]).prod() - 1, (1 + w["ret"]["rules"]).prod() - 1
    avg_f = res[res.agent == "filter"].total_r.sum() / res[res.agent == "filter"].trades.sum()
    avg_r = res[res.agent == "rules"].total_r.sum() / res[res.agent == "rules"].trades.sum()
    bad = w["ret"]["rules"] < 0
    print(f"\nWalk-forward 2021-2026, {len(w)} tests (year x coin), 1% risk per trade\n")
    by_year = res.groupby(["year", "agent"]).agg(ret=("ret", "mean"), trades=("trades", "sum")).unstack()
    print("Average return per coin, by year:")
    for y in TEST_YEARS:
        print(f"  {y}: rules {by_year.loc[y, ('ret', 'rules')]:+6.1%} ({int(by_year.loc[y, ('trades', 'rules')]):3} trades)   "
              f"filter {by_year.loc[y, ('ret', 'filter')]:+6.1%} ({int(by_year.loc[y, ('trades', 'filter')]):3} trades)")
    print(f"\nA. filter better / worse / same:  {wins} / {losses} / {ties}   (need better > worse)")
    print(f"B. compounded over all tests:     filter {comp_f:+.0%} vs rules {comp_r:+.0%}   (need filter higher)")
    print(f"C. average trade:                 filter {avg_f:+.3f}R vs rules {avg_r:+.3f}R   (need filter higher)")
    print(f"D. in losing tests for the rules: filter {w['ret']['filter'][bad].mean():+.1%} vs rules "
          f"{w['ret']['rules'][bad].mean():+.1%}   (information: does it soften bad years?)")
    ok = wins > losses and comp_f > comp_r and avg_f > avg_r
    print(f"\nVERDICT: {'the learned filter ADDS value over the plain rules' if ok else 'the learned filter does NOT add value'}")

    latest = tables[TEST_YEARS[-1]].sort_values("score")
    print(f"\nWhat it learned most recently (trained {TEST_YEARS[-1] - TRAIN_YEARS}-{TEST_YEARS[-1] - 1}), worst situations first:")
    for code, r in latest.head(6).iterrows():
        print(f"  {'SKIP' if not r.keep else 'take'}  {r.n:3.0f} trades, avg {r.avg:+.2f}R  | {describe(code)}")
    print("  ...")
    for code, r in latest.tail(3).iterrows():
        print(f"  take  {r.n:3.0f} trades, avg {r.avg:+.2f}R  | {describe(code)}")


if __name__ == "__main__":
    main()

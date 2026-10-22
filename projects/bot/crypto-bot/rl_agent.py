"""A trading bot that learns from rewards (tabular Q-learning).

Every closed trade is scored in R, the profit or loss divided by the amount risked:
    +2.0  a good trade that made twice what it risked   -> positive reward
    -1.0  a failed trade that hit its stop-loss          -> negative reward
Fees and slippage are included, so a break-even trade earns slightly less than 0.

The bot sees a small, readable description of the market each candle (trend, momentum,
breakout, RSI zone, volatility, and how its open trade is doing) and learns which
action, buy/wait or hold/sell, leads to the most reward. A 2 x ATR stop-loss is
always placed and cannot be learned away, so a single trade loses about 1R at most
(more only if price gaps through the stop).

Training uses 2018-2022 only. 2023-now is kept hidden and used once, as a test.

    python rl_agent.py                 # daily candles, 10 training runs
    python rl_agent.py --tf 4h         # 4-hour candles
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from strategies import atr, ema, rsi
from tradingview_data import load_candles

FEE, SLIP = 0.001, 0.0005
TRAIN = ("2018-01-01", "2022-12-31")
TEST = ("2023-01-01", None)
COINS = ["BTC", "ETH"]
RESULTS = Path(__file__).parent / "results"

# ---------- state: a handful of readable market conditions ----------

N_MARKET = 2 * 2 * 3 * 4 * 2   # trend x momentum x breakout x RSI zone x volatility
N_TRADE = 5                    # flat, or open trade at <-0.5R, -0.5..0.5R, 0.5..2R, >2R
N_STATES, N_ACTIONS = N_MARKET * N_TRADE, 2   # action 0 = wait/hold, 1 = buy/sell


def features(df):
    c = df.close
    a = atr(df)
    f = pd.DataFrame(index=df.index)
    f["trend"] = (c > ema(c, 200)).astype(int)
    f["mom"] = (ema(c, 20) > ema(c, 50)).astype(int)
    hi20, lo10 = df.high.rolling(20).max().shift(), df.low.rolling(10).min().shift()
    f["brk"] = np.select([c > hi20, c < lo10], [2, 0], 1)
    f["rsi"] = np.digitize(rsi(c), [30, 50, 70])
    atr_pct = a / c
    f["vol"] = (atr_pct > atr_pct.rolling(100).median()).astype(int)
    f["market"] = ((((f.trend * 2 + f.mom) * 3 + f.brk) * 4 + f.rsi) * 2 + f.vol).astype(int)
    f["atr"] = a
    return f.iloc[200:]  # skip the EMA-200 warm-up


def describe(market):
    vol, market = market % 2, market // 2
    r, market = market % 4, market // 4
    brk, market = market % 3, market // 3
    mom, trend = market % 2, market // 2
    return (f"{'up' if trend else 'down'}trend, EMA20 {'>' if mom else '<'} EMA50, "
            f"{['10-bar low break', 'inside range', '20-bar high break'][brk]}, "
            f"RSI {['<30', '30-50', '50-70', '>70'][r]}, {'high' if vol else 'low'} volatility")


def trade_bucket(r_open):
    return 1 + int(np.digitize(r_open, [-0.5, 0.5, 2.0]))


# ---------- market simulator (same fill rules as backtest.py) ----------

class Market:
    def __init__(self, df):
        f = features(df)
        d = df.loc[f.index]
        self.o, self.h, self.l, self.c = (d[k].to_numpy() for k in ("open", "high", "low", "close"))
        self.market, self.atr, self.index = f.market.to_numpy(), f.atr.to_numpy(), f.index
        self.n = len(f)

    def run(self, policy, learn=None, reward_mode="step"):
        """Walk through the candles. `policy(state, i) -> action`; `learn(s, a, r, s2)` updates.

        reward_mode "trade": the whole R arrives when the trade closes.
        reward_mode "step":  the trade's R is paid out candle by candle as its value changes;
                             the pieces add up to exactly the same R per trade.
        Returns the list of closed trades.
        """
        trades, pos = [], None
        state = self.market[0] * N_TRADE
        for i in range(self.n - 1):
            a = policy(state, i)
            reward, nxt = 0.0, i + 1
            o, l = self.o[nxt], self.l[nxt]
            if pos is None and a == 1:
                entry = o * (1 + SLIP)
                pos = dict(entry=entry, stop=entry - 2 * self.atr[i], risk=2 * self.atr[i], start=nxt,
                           mark=entry * (1 + FEE))
            elif pos is not None and a == 1:
                reward = self._close(pos, o, "signal", nxt, trades, reward_mode)
                pos = None
            if pos is not None and (o <= pos["stop"] or l <= pos["stop"]):
                reward += self._close(pos, min(o, pos["stop"]), "stop", nxt, trades, reward_mode)
                pos = None
            if pos is not None and reward_mode == "step":
                reward += (self.c[nxt] - pos["mark"]) / pos["risk"]
                pos["mark"] = self.c[nxt]
            trade = 0 if pos is None else trade_bucket((self.c[nxt] - pos["entry"]) / pos["risk"])
            next_state = self.market[nxt] * N_TRADE + trade
            if learn:
                learn(state, a, reward, next_state)
            state = next_state
        if pos is not None:  # score the trade still open at the end
            self._close(pos, self.c[-1], "open at end", self.n - 1, trades)
        return trades

    def run_entries(self, policy, learn=None):
        """The bot only chooses WHEN TO BUY; exits follow the Breakout rule (close below the
        10-bar low) or the stop. Each buy is rewarded with that trade's final R, + or -.

        `learn(s, a, r, s2, k)` gets k = number of candles the decision covered.
        """
        trades, pos, pending = [], None, None
        for i in range(self.n - 1):
            nxt, state = i + 1, self.market[i] * N_TRADE
            o, l = self.o[nxt], self.l[nxt]
            if pos is None:
                a = policy(state, i)
                if a == 1:
                    entry = o * (1 + SLIP)
                    pos = dict(entry=entry, stop=entry - 2 * self.atr[i], risk=2 * self.atr[i], start=nxt)
                    pending = (state, i)
                elif learn:
                    learn(state, 0, 0.0, self.market[nxt] * N_TRADE, 1)
            elif (self.market[i] // 2 // 4) % 3 == 0:  # previous close broke the 10-bar low
                r = self._close(pos, o, "10-bar low", nxt, trades)
                pos = None
            if pos is not None and (o <= pos["stop"] or l <= pos["stop"]):
                r = self._close(pos, min(o, pos["stop"]), "stop", nxt, trades)
                pos = None
            if pos is None and pending is not None:
                s0, i0 = pending
                if learn:
                    learn(s0, 1, r, self.market[nxt] * N_TRADE, nxt - i0)
                pending = None
        if pos is not None:
            self._close(pos, self.c[-1], "open at end", self.n - 1, trades)
        return trades

    def _close(self, pos, px, reason, i, trades, reward_mode="trade"):
        exit_px = px * (1 - SLIP)
        r = (exit_px * (1 - FEE) - pos["entry"] * (1 + FEE)) / pos["risk"]
        ret = exit_px * (1 - FEE) / (pos["entry"] * (1 + FEE)) - 1
        trades.append(dict(entry_time=self.index[pos["start"]], exit_time=self.index[i], r=r, ret=ret, reason=reason))
        if reward_mode == "step":  # the part of the trade's R not paid out yet
            return (exit_px * (1 - FEE) - pos["mark"]) / pos["risk"]
        return r  # the reward: + for a good trade, - for a failed one


# ---------- learning ----------

def train(markets, episodes=300, alpha=0.05, gamma=0.995, seed=0, reward_mode="step", mode="all"):
    rng = np.random.default_rng(seed)
    q = np.zeros((N_STATES, N_ACTIONS))

    def learn(s, a, r, s2, k=1):
        q[s, a] += alpha * (r + gamma ** k * q[s2].max() - q[s, a])

    for ep in range(episodes):
        eps = max(0.02, 0.3 * (1 - ep / (0.7 * episodes)))
        for m in markets:
            explore = lambda s, i: rng.integers(2) if rng.random() < eps else int(q[s].argmax())
            if mode == "entries":
                m.run_entries(explore, learn)
            else:
                m.run(explore, learn, reward_mode)
    return q


def play(market, policy, mode):
    return market.run_entries(policy) if mode == "entries" else market.run(policy)


def evaluate(market, policy, mode="all"):
    trades = pd.DataFrame(play(market, policy, mode))
    if trades.empty:
        return dict(trades=0, win_rate=np.nan, avg_r=np.nan, total_r=0.0, ret_1pct=0.0), trades
    equity = (1 + 0.01 * trades.r).prod() - 1  # each trade risks 1% of the account
    return dict(trades=len(trades), win_rate=(trades.r > 0).mean(), avg_r=trades.r.mean(),
                total_r=trades.r.sum(), ret_1pct=equity), trades


def breakout_policy(market):
    """The rule-based Breakout bot, expressed in the same state space for a fair comparison."""
    def policy(state, i):
        brk = (state // N_TRADE // 2 // 4) % 3
        flat = state % N_TRADE == 0
        return int(brk == 2) if flat else int(brk == 0)
    return policy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tf", default="1d", choices=["1d", "4h"])
    ap.add_argument("--runs", type=int, default=10, help="independent training runs (different random seeds)")
    ap.add_argument("--episodes", type=int, default=300)
    ap.add_argument("--reward", default="step", choices=["step", "trade"],
                    help="pay each trade's R candle by candle (step) or all at the close (trade)")
    ap.add_argument("--gamma", type=float, default=0.995, help="discount for future reward")
    ap.add_argument("--learn", default="all", choices=["all", "entries"],
                    help="learn buys and sells (all) or only when to buy, with rule-based exits (entries)")
    args = ap.parse_args()

    data = {}
    for coin in COINS:
        df, source = load_candles(coin, args.tf)
        data[coin] = df
        print(f"{coin} {args.tf}: {len(df):,} candles from {source}")
    train_m = [Market(data[c].loc[TRAIN[0]:TRAIN[1]]) for c in COINS]
    test_m = {c: Market(data[c].loc[pd.Timestamp(TRAIN[1], tz="UTC") - pd.Timedelta(days=400):]) for c in COINS}
    for c in COINS:  # keep only test-period trades: indicators need the earlier candles to warm up
        m = test_m[c]; keep = m.index >= pd.Timestamp(TEST[0], tz="UTC"); start = int(np.argmax(keep))
        for k in ("o", "h", "l", "c", "market", "atr"):
            setattr(m, k, getattr(m, k)[start:])
        m.index, m.n = m.index[start:], m.n - start

    rows, qs = [], []
    for seed in range(args.runs):
        q = train(train_m, args.episodes, gamma=args.gamma, seed=seed, reward_mode=args.reward, mode=args.learn)
        qs.append(q)
        greedy = lambda s, i, q=q: int(q[s].argmax())
        for c in COINS:
            rows.append(dict(agent="Learned (RL)", run=seed, coin=c, split="train", **evaluate(train_m[COINS.index(c)], greedy, args.learn)[0]))
            rows.append(dict(agent="Learned (RL)", run=seed, coin=c, split="test", **evaluate(test_m[c], greedy, args.learn)[0]))
        print(f"run {seed + 1}/{args.runs} done")
    for c in COINS:
        for split, m in (("train", train_m[COINS.index(c)]), ("test", test_m[c])):
            rows.append(dict(agent="Breakout rules", run=0, coin=c, split=split, **evaluate(m, breakout_policy(m))[0]))
            rows.append(dict(agent="Buy & hold", run=0, coin=c, split=split, trades=1, win_rate=np.nan, avg_r=np.nan,
                             total_r=np.nan, ret_1pct=m.c[-1] / m.o[0] - 1))

    res = pd.DataFrame(rows)
    RESULTS.mkdir(exist_ok=True)
    res.to_csv(RESULTS / f"rl_results_{args.tf}_{args.learn}.csv", index=False)

    # average Q-table across runs = the consensus policy; save it with readable rules
    q_mean = np.mean(qs, axis=0)
    agree = np.mean([q.argmax(1) == q_mean.argmax(1) for q in qs], axis=0)
    rules = []
    for s in range(N_STATES):
        market, trade = divmod(s, N_TRADE)
        if trade == 0 and q_mean[s].argmax() == 1 and q_mean[s].any():
            rules.append(dict(when=describe(market), action="BUY", edge_r=round(float(q_mean[s, 1] - q_mean[s, 0]), 3),
                              runs_agree=f"{agree[s]:.0%}"))
    rules.sort(key=lambda r: -r["edge_r"])
    (RESULTS / f"rl_policy_{args.tf}_{args.learn}.json").write_text(json.dumps(
        {"timeframe": args.tf, "trained_on": TRAIN, "q_table": q_mean.round(5).tolist(), "buy_rules": rules}, indent=2))

    summary = (res.groupby(["agent", "coin", "split"])
               .agg(trades=("trades", "mean"), win_rate=("win_rate", "mean"), avg_r=("avg_r", "mean"),
                    ret=("ret_1pct", "mean"), ret_worst=("ret_1pct", "min"), ret_best=("ret_1pct", "max"))
               .reset_index())
    pd.set_option("display.width", 200)
    fmt = summary.copy()
    for k in ("win_rate", "ret", "ret_worst", "ret_best"):
        fmt[k] = fmt[k].map(lambda v: "" if pd.isna(v) else f"{v:+.0%}" if k != "win_rate" else f"{v:.0%}")
    fmt["avg_r"] = fmt["avg_r"].map(lambda v: "" if pd.isna(v) else f"{v:+.2f}R")
    fmt["trades"] = fmt["trades"].round(0).astype(int)
    print(fmt.to_string(index=False))
    print(f"\nTop learned buy conditions ({len(rules)} total):")
    for r in rules[:8]:
        print(f"  {r['edge_r']:+.3f}R  agree {r['runs_agree']:>4}  {r['when']}")


if __name__ == "__main__":
    main()

"""Checks paper_trader.step() against a fake exchange.  Run: python test_paper_trader.py"""
import tempfile
from pathlib import Path

import pandas as pd

import paper_trader as pt


class FakeExchange:
    def __init__(self, price):
        self.price, self.orders, self.cancelled, self.n = price, {}, [], 0

    def fetch_ticker(self, symbol):
        return {"last": self.price}

    def market(self, symbol):
        return {"limits": {"cost": {"min": 5.0}}}

    def amount_to_precision(self, symbol, x):
        return f"{int(x * 1e5) / 1e5:.5f}"

    def price_to_precision(self, symbol, x):
        return f"{x:.2f}"

    def create_order(self, symbol, type_, side, qty, price=None, params=None):
        self.n += 1
        o = {"id": str(self.n), "type": type_, "side": side, "amount": qty, "params": params or {},
             "status": "open" if type_ == "STOP_LOSS" else "closed",
             "average": None if type_ == "STOP_LOSS" else self.price, "filled": qty}
        self.orders[o["id"]] = o
        return o

    def fetch_order(self, oid, symbol):
        return self.orders[oid]

    def cancel_order(self, oid, symbol):
        self.cancelled.append(oid)
        self.orders[oid]["status"] = "canceled"


def sig(entry=False, exit_=False, day="2026-10-20", stop_dist=2000.0):
    idx = pd.date_range(end=day, periods=25, freq="D", tz="UTC")
    df = pd.DataFrame({"open": 80000.0, "high": 81000.0, "low": 79000.0, "close": 80000.0,
                       "entry": False, "exit": False, "stop_dist": stop_dist}, index=idx)
    df.iloc[-1, df.columns.get_loc("entry")] = entry
    df.iloc[-1, df.columns.get_loc("exit")] = exit_
    return df


def main():
    tmp = Path(tempfile.mkdtemp())
    pt.STATE_FILE, pt.JOURNAL_FILE = tmp / "state.json", tmp / "journal.csv"
    S = "BTC/USDT"

    # 1. entry signal -> market buy + stop order sized to 1% risk of $1000
    ex, state = FakeExchange(80000.0), {"positions": {}, "last_bar": {}}
    pt.step(ex, S, sig(entry=True), state, 1000, 0.01)
    pos = state["positions"][S]
    buy, stop = ex.orders["1"], ex.orders["2"]
    assert buy["side"] == "buy" and buy["type"] == "market"
    assert abs(buy["amount"] - 0.005) < 1e-9, buy["amount"]          # $10 risk / $2000 stop distance
    assert stop["type"] == "STOP_LOSS" and stop["params"]["stopPrice"] == 78000.0
    assert pos["qty"] < buy["amount"]                                 # leaves room for the fee
    print("ok  entry: buy 0.005 BTC, stop order at 78,000")

    # 2. running again on the same candle does nothing
    pt.step(ex, S, sig(entry=True), state, 1000, 0.01)
    assert len(ex.orders) == 2
    print("ok  re-run on same candle places no new orders")

    # 3. next day, no signal -> hold
    pt.step(ex, S, sig(day="2026-10-21"), state, 1000, 0.01)
    assert S in state["positions"] and len(ex.orders) == 2
    print("ok  hold")

    # 4. exit signal -> cancel stop, market sell
    ex.price = 90000.0
    pt.step(ex, S, sig(exit_=True, day="2026-10-22"), state, 1000, 0.01)
    assert ex.cancelled == ["2"] and ex.orders["3"]["side"] == "sell" and S not in state["positions"]
    print("ok  exit signal: stop cancelled, sold at 90,000")

    # 5. stop filled on the exchange -> recorded as stop-out, position cleared
    ex, state = FakeExchange(80000.0), {"positions": {}, "last_bar": {}}
    pt.step(ex, S, sig(entry=True), state, 1000, 0.01)
    ex.orders["2"].update(status="closed", average=77950.0)
    pt.step(ex, S, sig(day="2026-10-21"), state, 1000, 0.01)
    assert S not in state["positions"]
    print("ok  stop-out detected")

    # 6. order below the $5 minimum is skipped
    ex, state = FakeExchange(80000.0), {"positions": {}, "last_bar": {}}
    pt.step(ex, S, sig(entry=True), state, 10, 0.01)
    assert not ex.orders
    print("ok  tiny account: order below minimum skipped")

    # 7. testnet reset wiped the stop order -> position cleared, no crash
    ex, state = FakeExchange(80000.0), {"positions": {}, "last_bar": {}}
    pt.step(ex, S, sig(entry=True), state, 1000, 0.01)
    del ex.orders["2"]
    ex.fetch_order = lambda oid, s: (_ for _ in ()).throw(pt.ccxt.OrderNotFound("gone"))
    pt.step(ex, S, sig(day="2026-10-21"), state, 1000, 0.01)
    assert S not in state["positions"]
    print("ok  testnet reset handled")

    rows = pd.read_csv(pt.JOURNAL_FILE)
    rows = rows[rows.action != "RESET"].iloc[:4]
    assert list(rows.action) == ["BUY", "SELL", "BUY", "SELL"], list(rows.action)
    assert list(rows.reason) == ["close above 20-day high", "10-day low", "close above 20-day high", "stop-loss"]
    print("ok  journal:", list(zip(rows.action, rows.reason, rows.pnl_pct.fillna(""))))


if __name__ == "__main__":
    main()

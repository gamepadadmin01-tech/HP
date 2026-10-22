"""Checks live_bot.Bot.tick() with a fake exchange and fake daily candles.  Run: python test_live_bot.py"""
import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import live_bot as lb
import paper_trader as pt
from test_paper_trader import FakeExchange


class FakeData:
    """Daily candles flat at 100, then (optionally) yesterday closes at `last_close`; today is still forming."""
    def __init__(self, last_close=100.0):
        self.last_close = last_close

    def fetch_ohlcv(self, symbol, tf, limit=200):
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        rows = []
        for k in range(60, -1, -1):  # 60 closed days + today's forming candle
            t = int((today - timedelta(days=k)).timestamp() * 1000)
            c = self.last_close if k == 1 else 100.0
            rows.append([t, 100.0, max(101.0, c), 99.0, c, 1.0])
        return rows


def fresh(tmp, last_close=100.0, price=100.0, **kw):
    for f in tmp.iterdir():
        f.unlink()
    lb.HERE, lb.STATUS_FILE = tmp, tmp / "status.json"
    pt.STATE_FILE, pt.JOURNAL_FILE = tmp / "state.json", tmp / "journal.csv"
    args = SimpleNamespace(account=1000.0, risk=0.01, max_position=50.0, max_daily_loss=0.03, **kw)
    pt.MAX_POSITION_USDT = args.max_position
    return lb.Bot(FakeExchange(price), FakeData(last_close), args)


def day(n):
    return str((datetime.now(timezone.utc) - timedelta(days=n)).date())


def main():
    lb.telegram = lambda text: None
    tmp = Path(tempfile.mkdtemp())

    # 1. first start with a breakout on yesterday's candle: do NOT trade a stale signal
    bot = fresh(tmp, last_close=130.0, price=130.0)
    bot.tick()
    st = pt.load_state()
    assert not st["positions"] and st["last_bar"]["BTC/USDT"] == day(1) and not bot.ex.orders
    print("ok  first start: stale breakout ignored, waits for next daily close")

    # 2. bot ran yesterday, new close breaks out -> buy, capped at 50 USDT
    bot = fresh(tmp, last_close=130.0, price=130.0)
    pt.save_state({"positions": {}, "last_bar": {s: day(2) for s in pt.SYMBOLS}})
    bot.tick()
    st = pt.load_state()
    assert set(st["positions"]) == {"BTC/USDT", "ETH/USDT"}
    buy = bot.ex.orders["1"]
    assert buy["side"] == "buy" and buy["amount"] * 130 <= 50.0 + 1e-6, buy["amount"] * 130
    status = json.loads(lb.STATUS_FILE.read_text())
    assert status["positions"]["BTC/USDT"]["qty"] > 0 and status["levels"]["BTC/USDT"]["candle"] == day(1)
    print(f"ok  new daily close breakout: bought, position ${buy['amount'] * 130:.2f} (cap $50), status file written")

    # 3. running again the same day places nothing new
    n = len(bot.ex.orders); bot.tick()
    assert len(bot.ex.orders) == n
    print("ok  re-tick same day: no duplicate orders")

    # 4. STOP file: halted, new signal skipped
    bot = fresh(tmp, last_close=130.0, price=130.0)
    pt.save_state({"positions": {}, "last_bar": {s: day(2) for s in pt.SYMBOLS}})
    (tmp / "STOP").write_text("")
    bot.tick()
    assert bot.halted and not bot.ex.orders and pt.load_state()["last_bar"]["BTC/USDT"] == day(1)
    (tmp / "STOP").unlink(); bot.tick()
    assert not bot.halted
    print("ok  STOP file blocks the signal; removing it resumes")

    # 5. FLATTEN file sells open positions and halts
    bot = fresh(tmp, last_close=130.0, price=130.0)
    pt.save_state({"positions": {}, "last_bar": {s: day(2) for s in pt.SYMBOLS}})
    bot.tick()
    (tmp / "FLATTEN").write_text("")
    bot.tick()
    sells = [o for o in bot.ex.orders.values() if o["side"] == "sell" and o["type"] == "market"]
    assert len(sells) == 2 and not pt.load_state()["positions"] and bot.halted
    print("ok  FLATTEN sells everything and halts")

    # 6. daily loss limit: big unrealised loss halts new trades
    bot = fresh(tmp, last_close=130.0, price=130.0)
    pt.save_state({"positions": {"BTC/USDT": dict(qty=10.0, entry=130.0, stop=1.0, stop_order_id="x", entry_time=day(3))},
                   "last_bar": {s: day(1) for s in pt.SYMBOLS}})
    bot.ex.orders["x"] = {"id": "x", "status": "open"}
    bot.ex.price = 125.0  # 10 x -5 = -50 USDT > 3% of 1000
    bot.tick()
    assert bot.halted and bot.halt_reason.startswith("daily loss")
    print("ok  daily loss limit halts trading")

    # 7. risk above 3% is refused at startup
    import sys
    sys.argv = ["live_bot.py", "--risk", "0.05"]
    try:
        lb.main(); raise AssertionError("should have refused")
    except SystemExit as e:
        assert "3%" in str(e)
    print("ok  --risk above 3% refused")


if __name__ == "__main__":
    main()

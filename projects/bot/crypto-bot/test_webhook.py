"""Checks webhook_server parsing and order handling with a fake exchange.  Run: python test_webhook.py"""
import json
import tempfile
from pathlib import Path

import paper_trader as pt
import webhook_server as ws
from test_paper_trader import FakeExchange

SECRET = "correct-horse-battery"


def body(**kw):
    return json.dumps({"secret": SECRET, **kw})


def main():
    # --- parsing ---
    assert ws.parse_alert("not json", SECRET)[1][0] == 400
    assert ws.parse_alert(body(action="buy", symbol="BTCUSDT").replace(SECRET, "wrong"), SECRET)[1][0] == 401
    assert ws.parse_alert(json.dumps({"action": "buy", "symbol": "BTCUSDT"}), SECRET)[1][0] == 401
    assert ws.parse_alert(body(action="hodl", symbol="BTCUSDT"), SECRET)[1][0] == 400
    assert ws.parse_alert(body(action="buy", symbol="DOGEUSDT"), SECRET)[1][0] == 400
    assert ws.parse_alert(body(action="buy", symbol="BTCUSDT", stop_dist=-5), SECRET)[1][0] == 400
    a, err = ws.parse_alert(body(action="BUY", symbol="BINANCE:BTCUSDT", stop_dist="2000"), SECRET)
    assert err is None and a["symbol"] == "BTC/USDT" and a["stop_dist"] == 2000.0 and a["action"] == "buy"
    # the format the Pine script produces: fields nested under "order"
    nested = json.dumps({"secret": SECRET, "order": {"action": "sell", "symbol": "ETHUSDT", "comment": "10-day low"}})
    a, err = ws.parse_alert(nested, SECRET)
    assert err is None and a["symbol"] == "ETH/USDT" and a["action"] == "sell" and a["comment"] == "10-day low"
    print("ok  parsing: bad JSON, bad secret, bad action/symbol/stop rejected; flat and nested formats accepted")

    # --- order handling ---
    tmp = Path(tempfile.mkdtemp())
    pt.STATE_FILE, pt.JOURNAL_FILE = tmp / "state.json", tmp / "journal.csv"
    ex = FakeExchange(80000.0)
    bridge = ws.Bridge(ex, None, account=1000, risk=0.01, dry_run=False)
    buy = {"action": "buy", "symbol": "BTC/USDT", "stop_dist": 2000.0, "comment": "20-day high breakout"}
    sell = {"action": "sell", "symbol": "BTC/USDT", "stop_dist": None, "comment": "10-day low"}

    bridge.handle(buy)
    assert [o["type"] for o in ex.orders.values()] == ["market", "STOP_LOSS"]
    assert ex.orders["2"]["params"]["stopPrice"] == 78000.0
    print("ok  buy alert: market buy + exchange stop at 78,000")

    bridge.handle(buy)
    assert len(ex.orders) == 2
    print("ok  duplicate buy alert ignored")

    ex.price = 85000.0
    bridge.handle(sell)
    assert ex.cancelled == ["2"] and ex.orders["3"]["side"] == "sell"
    assert pt.load_state()["positions"] == {}
    print("ok  sell alert: stop cancelled, market sell")

    bridge.handle(sell)
    assert len(ex.orders) == 3
    print("ok  sell alert with no open trade ignored")

    bridge.handle(buy)
    ex.orders["5"].update(status="closed", average=77900.0)  # exchange stop filled
    bridge.handle(sell)  # TradingView's own stop alert arrives afterwards
    assert len(ex.orders) == 5 and pt.load_state()["positions"] == {}
    print("ok  exchange stop filled first: later sell alert does not sell twice")

    bridge.default_stop_dist = lambda s: 3000.0
    bridge.handle({**buy, "stop_dist": None})
    assert ex.orders["7"]["params"]["stopPrice"] == 82000.0  # fill 85,000 - 3,000
    print("ok  buy alert without stop_dist falls back to ATR stop")


if __name__ == "__main__":
    main()

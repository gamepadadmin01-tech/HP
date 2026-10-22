"""Paper-trade the Breakout strategy on the Binance spot TESTNET.

Signals come from real Binance daily candles; orders go to the testnet,
where the money is fake. Each run, for BTC/USDT and ETH/USDT:

  * flat + breakout signal  -> market buy, then a STOP_LOSS sell order on the exchange
  * in trade + stop filled  -> record the stop-out
  * in trade + exit signal  -> cancel the stop, market sell
  * otherwise               -> hold / wait

Each daily candle is acted on once, so running it twice a day is safe.
Positions live in paper_state.json, every fill is logged to paper_journal.csv.

Setup: create keys at https://testnet.binance.vision (log in with GitHub),
then set them as environment variables (never paste them into code or chat):

    setx BINANCE_TESTNET_API_KEY "..."
    setx BINANCE_TESTNET_SECRET "..."

Run:
    python paper_trader.py --dry-run      # show what it would do, no keys needed
    python paper_trader.py                # act once on the last closed candle
    python paper_trader.py --loop         # keep running, act after every daily close
"""
import argparse
import csv
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import ccxt
import pandas as pd

from fetch_data import binance
from strategies import donchian_breakout

HERE = Path(__file__).parent
STATE_FILE = HERE / "paper_state.json"
JOURNAL_FILE = HERE / "paper_journal.csv"
SYMBOLS = ["BTC/USDT", "ETH/USDT"]
MAX_POSITION_USDT = None  # hard cap on any single position; set by live_bot.py


def fp(price):
    """A price as people read it: cents for big coins, enough digits for cheap ones (0.07123, not 0.07)."""
    return f"{price:,.2f}" if abs(price) >= 10 else f"{price:.4g}"


def log(msg):
    print(f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}Z  {msg}", flush=True)


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"positions": {}, "last_bar": {}}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def journal(row):
    new = not JOURNAL_FILE.exists()
    with JOURNAL_FILE.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["time", "symbol", "action", "qty", "price", "stop", "pnl_pct", "pnl_usdt", "reason", "order_id"])
        if new:
            w.writeheader()
        w.writerow({"time": datetime.now(timezone.utc).isoformat(timespec="seconds"), **row})


def daily_candles(market_data, symbol):
    rows = market_data.fetch_ohlcv(symbol, "1d", limit=200)
    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    return df.set_index("time").iloc[:-1]  # drop the candle that is still forming


def testnet_exchange():
    key, secret = os.getenv("BINANCE_TESTNET_API_KEY"), os.getenv("BINANCE_TESTNET_SECRET")
    if not key or not secret:
        raise SystemExit("Set BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_SECRET first (see top of this file).")
    ex = binance(apiKey=key, secret=secret)
    ex.set_sandbox_mode(True)
    if "testnet" not in ex.urls["api"]["private"]:
        raise SystemExit("Refusing to run: exchange is not pointed at the testnet.")
    ex.load_markets()
    return ex


def check_stop(ex, symbol, state):
    """Sync an open position with its exchange stop order.

    Returns False if the stop was cancelled by hand (leave the position alone), else True.
    """
    pos = state["positions"].get(symbol)
    if not pos:
        return True
    try:
        stop_order = ex.fetch_order(pos["stop_order_id"], symbol)
    except ccxt.OrderNotFound:  # the testnet is wiped roughly once a month
        log(f"{symbol}: stop order no longer exists (testnet reset?); clearing the position")
        journal(dict(symbol=symbol, action="RESET", qty=pos["qty"], price="", stop=pos["stop"], pnl_pct="",
                     reason="stop order not found", order_id=pos["stop_order_id"]))
        del state["positions"][symbol]
        return True
    if stop_order["status"] == "closed":
        px = stop_order.get("average") or pos["stop"]
        pnl = px / pos["entry"] - 1
        log(f"{symbol}: STOPPED OUT at {fp(px)} ({pnl:+.1%})")
        journal(dict(symbol=symbol, action="SELL", qty=pos["qty"], price=px, stop=pos["stop"],
                     pnl_pct=round(pnl * 100, 2), pnl_usdt=round(pos["qty"] * (px - pos["entry"]), 2),
                     reason="stop-loss", order_id=stop_order["id"]))
        del state["positions"][symbol]
    elif stop_order["status"] == "canceled":
        log(f"{symbol}: stop order was cancelled outside the bot; leaving position for you to handle")
        return False
    return True


def open_long(ex, symbol, state, account, risk, stop_dist, reason, entry_time, dry_run=False, cash=None):
    """Market-buy sized to `risk` of `account`, then place an exchange stop `stop_dist` below the fill.

    `cash`, when given, is the money not already tied up in other open trades; the buy never uses more.
    """
    price = ex.fetch_ticker(symbol)["last"]
    qty = min(account * risk / stop_dist, account / price)
    if MAX_POSITION_USDT:
        qty = min(qty, MAX_POSITION_USDT / price)
    cash_limited = cash is not None and qty * price * (1 + 0.001) > cash
    if cash_limited:
        qty = max(cash, 0) / (price * (1 + 0.001))
    qty = float(ex.amount_to_precision(symbol, qty))
    min_cost = ex.market(symbol)["limits"]["cost"]["min"] or 0
    if qty * price < min_cost:
        why = "not enough free cash, other trades are using it" if cash_limited else "raise --account"
        log(f"{symbol}: signal, but order of ${qty * price:,.2f} is below the ${min_cost} minimum; {why}")
        return
    if dry_run:
        log(f"{symbol}: [dry-run] would BUY {qty} (~${qty * price:,.0f}) at ~{fp(price)}, "
            f"stop ~{fp(price - stop_dist)}")
        return
    order = ex.create_order(symbol, "market", "buy", qty)
    fill = order.get("average") or price
    filled = order.get("filled") or qty
    sell_qty = float(ex.amount_to_precision(symbol, filled * (1 - 0.001)))  # fee may be taken in the coin
    stop = float(ex.price_to_precision(symbol, fill - stop_dist))
    stop_order = ex.create_order(symbol, "STOP_LOSS", "sell", sell_qty, None, {"stopPrice": stop})
    state["positions"][symbol] = dict(qty=sell_qty, entry=fill, stop=stop, stop_order_id=stop_order["id"],
                                      entry_time=entry_time)
    log(f"{symbol}: BUY {sell_qty} at {fp(fill)}, stop-loss order at {fp(stop)}")
    journal(dict(symbol=symbol, action="BUY", qty=sell_qty, price=fill, stop=stop, pnl_pct="",
                 reason=reason, order_id=order["id"]))


def close_long(ex, symbol, state, reason, dry_run=False):
    """Cancel the exchange stop and market-sell the open position."""
    pos = state["positions"][symbol]
    if dry_run:
        log(f"{symbol}: [dry-run] would SELL {pos['qty']} ({reason})")
        return
    ex.cancel_order(pos["stop_order_id"], symbol)
    order = ex.create_order(symbol, "market", "sell", pos["qty"])
    px = order.get("average") or ex.fetch_ticker(symbol)["last"]
    pnl = px / pos["entry"] - 1
    log(f"{symbol}: SELL {pos['qty']} at {fp(px)} ({pnl:+.1%}), {reason}")
    journal(dict(symbol=symbol, action="SELL", qty=pos["qty"], price=px, stop=pos["stop"],
                 pnl_pct=round(pnl * 100, 2), pnl_usdt=round(pos["qty"] * (px - pos["entry"]), 2),
                 reason=reason, order_id=order["id"]))
    del state["positions"][symbol]


def step(ex, symbol, sig, state, account, risk, dry_run=False, cash=None):
    """Act on the last closed candle in `sig` for one symbol. `cash`: see open_long."""
    bar = str(sig.index[-1].date())
    last = sig.iloc[-1]

    if not dry_run and not check_stop(ex, symbol, state):
        return
    if state["last_bar"].get(symbol) == bar:
        log(f"{symbol}: candle {bar} already handled")
        return

    pos = state["positions"].get(symbol)
    if pos:
        if last.exit:
            close_long(ex, symbol, state, "10-day low", dry_run)
        else:
            log(f"{symbol}: HOLD since {pos['entry_time']} at {fp(pos['entry'])}, stop {fp(pos['stop'])}")
    elif last.entry:
        open_long(ex, symbol, state, account, risk, float(last.stop_dist), "close above 20-day high", bar, dry_run, cash)
    else:
        log(f"{symbol}: WAIT; buy trigger is a daily close above {fp(sig.high.tail(20).max())}")

    if not dry_run:
        state["last_bar"][symbol] = bar


def run_once(args):
    market_data = binance(mirror=True)  # real prices for signals
    ex = market_data if args.dry_run else testnet_exchange()
    if args.dry_run:
        ex.load_markets()
    state = load_state()
    for symbol in SYMBOLS:
        sig = donchian_breakout(daily_candles(market_data, symbol))
        try:
            step(ex, symbol, sig, state, args.account, args.risk, args.dry_run)
        except ccxt.BaseError as e:
            log(f"{symbol}: exchange error, will retry next run: {e}")
        if not args.dry_run:
            save_state(state)


def seconds_until_next_close(buffer_min=5):
    now = datetime.now(timezone.utc)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=buffer_min, second=0, microsecond=0)
    return (nxt - now).total_seconds()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--account", type=float, default=1000.0, help="virtual account size in USDT (default 1000)")
    ap.add_argument("--risk", type=float, default=0.01, help="fraction of account lost if the stop is hit (default 0.01)")
    ap.add_argument("--dry-run", action="store_true", help="print actions without placing orders")
    ap.add_argument("--loop", action="store_true", help="run now, then again 5 minutes after every daily close")
    args = ap.parse_args()
    while True:
        run_once(args)
        if not args.loop:
            break
        wait = seconds_until_next_close()
        log(f"sleeping {wait / 3600:.1f}h until the next daily close")
        time.sleep(wait)


if __name__ == "__main__":
    main()

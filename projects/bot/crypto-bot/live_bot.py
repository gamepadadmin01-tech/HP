"""Run the Breakout bot 24/7: watch prices every minute, trade at each daily close.

Every minute it:
  * reads live prices and checks each open trade's exchange stop-loss
  * updates live_status.json and the dashboard at http://localhost:8077
  * checks the kill-switch files (see below)
Right after each daily close (00:00 UTC = 05:30 IST) it runs the Breakout rules and
places orders, with a stop-loss order on the exchange for every buy.

Safety:
  --max-position     hard cap on any one position, in USDT (default 200)
  --max-daily-loss   stop opening trades for the rest of the UTC day after losing this
                     fraction of the account (default 0.03 = 3%); open stops stay in place
  STOP file          create a file named STOP in this folder: no new trades
  FLATTEN file       create a file named FLATTEN: sell every open position, then stop trading

Modes:
  testnet (default)  fake money on testnet.binance.vision; keys BINANCE_TESTNET_API_KEY / _SECRET
  live               REAL MONEY. Needs all of: --mode live, keys BINANCE_LIVE_API_KEY / BINANCE_LIVE_SECRET
                     (with withdrawals disabled: the bot refuses keys that can withdraw), and
                     LIVE_TRADING_CONFIRM=I_ACCEPT_REAL_MONEY_RISK in the environment.

Telegram alerts (optional): set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.

    python live_bot.py                      # testnet
    python live_bot.py --account 500 --risk 0.01 --max-position 150
"""
import argparse
import json
import os
import threading
import time
import traceback
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import ccxt
import pandas as pd
import requests

import paper_trader as pt
from strategies import donchian_breakout

HERE = pt.HERE
STATUS_FILE = HERE / "live_status.json"
LOOP_SECONDS = 60
CONFIRM_PHRASE = "I_ACCEPT_REAL_MONEY_RISK"


# ---------- alerts ----------

def telegram(text):
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return
    try:
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      json={"chat_id": chat, "text": text}, timeout=10)
    except requests.RequestException as e:
        print(f"telegram failed: {e}", flush=True)


_plain_log = pt.log
ALERT_WORDS = ("BUY", "SELL", "STOPPED", "RESET", "cancelled", "HALT", "ERROR", "FLATTEN", "started")


def log(msg):
    _plain_log(msg)
    if any(w in msg for w in ALERT_WORDS):
        telegram(f"[{MODE}] {msg}")


pt.log = log  # trades placed through paper_trader now also alert
MODE = "testnet"


# ---------- exchanges ----------

def public_data():
    """Real Binance prices. Uses the public market-data mirror, which is reachable more reliably."""
    ex = ccxt.binance({"enableRateLimit": True, "timeout": 20000})
    ex.urls["api"]["public"] = "https://data-api.binance.vision/api/v3"
    return ex


def live_exchange():
    key, secret = os.getenv("BINANCE_LIVE_API_KEY"), os.getenv("BINANCE_LIVE_SECRET")
    if os.getenv("LIVE_TRADING_CONFIRM") != CONFIRM_PHRASE:
        raise SystemExit(f"Live mode needs LIVE_TRADING_CONFIRM={CONFIRM_PHRASE} in the environment.")
    if not key or not secret:
        raise SystemExit("Live mode needs BINANCE_LIVE_API_KEY and BINANCE_LIVE_SECRET.")
    ex = ccxt.binance({"apiKey": key, "secret": secret, "enableRateLimit": True, "timeout": 20000})
    if "testnet" in ex.urls["api"]["private"]:
        raise SystemExit("Live exchange unexpectedly points at the testnet.")
    restrictions = ex.sapi_get_account_apirestrictions()
    if restrictions.get("enableWithdrawals"):
        raise SystemExit("This API key can WITHDRAW funds. Create a key with withdrawals disabled.")
    if not restrictions.get("enableSpotAndMarginTrading"):
        raise SystemExit("This API key cannot trade spot. Enable 'Spot & Margin Trading' on the key.")
    ex.load_markets()
    return ex


# ---------- the bot ----------

class Bot:
    def __init__(self, ex, data, args):
        self.ex, self.data, self.args = ex, data, args
        self.levels, self.levels_time = {}, 0.0
        self.halted, self.halt_reason, self.errors, self.last_error = False, "", 0, ""
        self.trading_day = None

    def account_size(self):
        if MODE != "live":
            return self.args.account
        free = self.ex.fetch_balance()["free"].get("USDT", 0.0)
        return min(self.args.account, free)  # never size off more than you said, or more than you have

    def realized_today(self):
        if not pt.JOURNAL_FILE.exists():
            return 0.0
        j = pd.read_csv(pt.JOURNAL_FILE)
        if "pnl_usdt" not in j or j.empty:
            return 0.0
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return float(pd.to_numeric(j[j.time.str.startswith(today)].pnl_usdt, errors="coerce").fillna(0).sum())

    def refresh_levels(self, force=False):
        if not force and time.time() - self.levels_time < 3600:
            return
        for sym in pt.SYMBOLS:
            df = pt.daily_candles(self.data, sym)
            self.levels[sym] = dict(buy_above=float(df.high.tail(20).max()), exit_below=float(df.low.tail(10).min()),
                                    last_close=float(df.close.iloc[-1]), candle=str(df.index[-1].date()))
        self.levels_time = time.time()

    def kill_switches(self, state):
        if (HERE / "FLATTEN").exists():
            for sym in list(state["positions"]):
                log(f"{sym}: FLATTEN file found, selling")
                pt.close_long(self.ex, sym, state, "FLATTEN kill switch")
            pt.save_state(state)
            self.halted, self.halt_reason = True, "FLATTEN file present: all positions sold, no new trades"
        elif (HERE / "STOP").exists():
            if not self.halted:
                log("HALT: STOP file found, no new trades (open stops stay in place)")
            self.halted, self.halt_reason = True, "STOP file present"
        elif self.halt_reason.endswith("file present"):
            log("STOP file removed, trading resumes")
            self.halted, self.halt_reason = False, ""

    def daily_loss_check(self, state, prices):
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if day != self.trading_day:  # new UTC day: lift a loss halt from yesterday
            if self.halt_reason.startswith("daily loss"):
                self.halted, self.halt_reason = False, ""
            self.trading_day = day
        unreal = sum(p["qty"] * (prices.get(s, p["entry"]) - p["entry"]) for s, p in state["positions"].items())
        loss = self.realized_today() + min(unreal, 0)
        limit = -self.args.max_daily_loss * self.args.account
        if loss <= limit and not self.halted:
            self.halted, self.halt_reason = True, f"daily loss limit hit ({loss:,.2f} USDT)"
            log(f"HALT: {self.halt_reason}; no new trades until 00:00 UTC")
        return loss

    def tick(self):
        state = pt.load_state()
        for sym in list(state["positions"]):
            pt.check_stop(self.ex, sym, state)
        pt.save_state(state)
        prices = {s: float(self.ex.fetch_ticker(s)["last"]) for s in pt.SYMBOLS}
        self.kill_switches(state)
        loss_today = self.daily_loss_check(state, prices)

        self.refresh_levels()
        latest = datetime.now(timezone.utc) - pd.Timedelta(days=1)
        if any(lv["candle"] < str(latest.date()) for lv in self.levels.values()):
            self.refresh_levels(force=True)  # a new daily candle has closed
        for sym in pt.SYMBOLS:
            if sym not in state["last_bar"]:  # first start: don't act on a candle that closed hours ago
                state["last_bar"][sym] = self.levels[sym]["candle"]
                log(f"{sym}: started; waiting for the next daily close (00:00 UTC) before trading")
                pt.save_state(state)
            if state["last_bar"].get(sym) != self.levels[sym]["candle"]:
                if self.halted:
                    log(f"{sym}: daily close {self.levels[sym]['candle']} skipped, bot is halted ({self.halt_reason})")
                    state["last_bar"][sym] = self.levels[sym]["candle"]
                else:
                    sig = donchian_breakout(pt.daily_candles(self.data, sym))
                    pt.step(self.ex, sym, sig, state, self.account_size(), self.args.risk)
                pt.save_state(state)
        self.write_status(state, prices, loss_today)

    def write_status(self, state, prices, loss_today):
        positions = {}
        for s, p in state["positions"].items():
            px = prices.get(s, p["entry"])
            positions[s] = dict(p, price=px, pnl_usdt=round(p["qty"] * (px - p["entry"]), 2),
                                pnl_r=round((px - p["entry"]) / max(p["entry"] - p["stop"], 1e-9), 2))
        status = dict(mode=MODE, updated=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      halted=self.halted, halt_reason=self.halt_reason, prices=prices, positions=positions,
                      levels=self.levels, today_pnl_usdt=round(loss_today, 2), account=self.args.account,
                      risk=self.args.risk, max_position=self.args.max_position,
                      max_daily_loss=self.args.max_daily_loss, last_error=self.last_error)
        tmp = STATUS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(status, indent=2))
        tmp.replace(STATUS_FILE)

    def run_forever(self):
        log(f"bot started: {MODE}, account {self.args.account:,.0f} USDT, risk {self.args.risk:.1%}, "
            f"max position {self.args.max_position:,.0f} USDT, daily loss limit {self.args.max_daily_loss:.0%}")
        while True:
            try:
                self.tick()
                if self.errors >= 3:
                    log("connection restored")
                self.errors, self.last_error = 0, ""
            except Exception as e:  # never die: log, back off, retry
                self.errors += 1
                self.last_error = f"{type(e).__name__}: {e}"[:300]
                _plain_log(f"error #{self.errors}: {self.last_error}")
                if self.errors in (3, 30):
                    log(f"ERROR: {self.errors} failures in a row: {self.last_error}")
                if self.errors == 1:
                    traceback.print_exc()
            time.sleep(min(LOOP_SECONDS * (2 ** max(self.errors - 1, 0)), 900))


# ---------- dashboard ----------

def serve_dashboard(port):
    class Quiet(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(HERE), **kw)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self.path = "/dashboard.html"
            if self.path.split("?")[0] not in ("/dashboard.html", "/live_status.json", "/journal.csv"):
                return self.send_error(404)
            if self.path.startswith("/journal.csv"):
                self.path = "/" + pt.JOURNAL_FILE.name
            return super().do_GET()

        def log_message(self, *a):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", port), Quiet)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    _plain_log(f"dashboard: http://localhost:{port}")


def main():
    global MODE
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["testnet", "live"], default="testnet")
    ap.add_argument("--account", type=float, default=1000.0, help="account size the bot may use, USDT (default 1000)")
    ap.add_argument("--risk", type=float, default=0.01, help="fraction of account lost if a stop is hit (default 0.01)")
    ap.add_argument("--max-position", type=float, default=200.0, help="largest single position, USDT (default 200)")
    ap.add_argument("--max-daily-loss", type=float, default=0.03, help="halt for the day after this loss (default 0.03)")
    ap.add_argument("--port", type=int, default=8077, help="dashboard port")
    args = ap.parse_args()
    if args.risk > 0.03:
        raise SystemExit("--risk above 3% per trade is not allowed.")

    MODE = args.mode
    pt.MAX_POSITION_USDT = args.max_position
    pt.STATE_FILE = HERE / f"{MODE}_state.json"
    pt.JOURNAL_FILE = HERE / f"{MODE}_journal.csv"
    ex = live_exchange() if MODE == "live" else pt.testnet_exchange()
    serve_dashboard(args.port)
    Bot(ex, public_data(), args).run_forever()


if __name__ == "__main__":
    main()

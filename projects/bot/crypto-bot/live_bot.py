"""Run the Breakout bot 24/7: watch prices every minute, trade at each daily close.

Every minute it:
  * reads live prices and checks each open trade's exchange stop-loss
  * updates live_status.json and the dashboard at http://localhost:8077
  * checks the kill-switch files (see below)
Right after each daily close (00:00 UTC = 05:30 IST) it runs the Breakout rules on every coin
and places orders, with a stop-loss order on the exchange for every buy.

Coins: BTC ETH SOL BNB XRP ADA DOGE LTC LINK AVAX by default (--coins to change), all sharing one
account. Each trade risks 0.3% of the account (--risk); portfolio.py showed 10 coins only beat
BTC+ETH alone at about this size, because altcoins tend to fall together.

Safety:
  shared cash        a new trade only gets money not already tied up in open trades
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

    python live_bot.py                      # testnet, 10 coins, 0.3% risk per trade
    python live_bot.py --account 500 --max-position 150
    python live_bot.py --coins BTC ETH --risk 0.01      # the original two-coin setup
"""
import argparse
import json
import os
import secrets
import threading
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import ccxt
import pandas as pd
import requests

import paper_trader as pt
from fetch_data import binance
from strategies import donchian_breakout

HERE = pt.HERE
COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "LTC", "LINK", "AVAX"]
STATUS_FILE = HERE / "live_status.json"
LOOP_SECONDS = 60   # check every minute while no trade is open
FAST_SECONDS = 15   # check every 15 seconds while a trade is open (the stop itself sits on Binance)
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


_print_log = pt.log
ACTIVITY_FILE = None  # <mode>_activity.log, set in main(); feeds the dashboard's Activity tab
EQUITY_FILE = None    # <mode>_equity.csv, set in main(); feeds the Performance chart
ALERT_WORDS = ("BUY", "SELL", "STOPPED", "RESET", "cancelled", "HALT", "ERROR", "FLATTEN", "started")


def _plain_log(msg):
    _print_log(msg)
    if ACTIVITY_FILE:
        try:
            with open(ACTIVITY_FILE, "a", encoding="utf-8") as f:
                f.write(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}\t{msg}\n")
        except OSError:
            pass


def log(msg):
    _plain_log(msg)
    if any(w in msg for w in ALERT_WORDS):
        telegram(f"[{MODE}] {msg}")


pt.log = log  # trades placed through paper_trader now also alert
MODE = "testnet"


def stay_awake():
    """Ask Windows not to idle-sleep while this program runs (what video players do).
    Changes no settings: it ends when the bot closes. A closed lid still sleeps."""
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        return bool(ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED))
    except (AttributeError, OSError):  # not Windows
        return False


# ---------- exchanges ----------

def public_data():
    """Real Binance prices, spot only, from the public market-data mirror."""
    return binance(mirror=True)


def live_exchange():
    key, secret = os.getenv("BINANCE_LIVE_API_KEY"), os.getenv("BINANCE_LIVE_SECRET")
    if os.getenv("LIVE_TRADING_CONFIRM") != CONFIRM_PHRASE:
        raise SystemExit(f"Live mode needs LIVE_TRADING_CONFIRM={CONFIRM_PHRASE} in the environment.")
    if not key or not secret:
        raise SystemExit("Live mode needs BINANCE_LIVE_API_KEY and BINANCE_LIVE_SECRET.")
    ex = binance(apiKey=key, secret=secret)
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
        self.candles = {}                 # recent daily candles per coin, for the dashboard charts
        self.wake = threading.Event()     # set by the dashboard's buttons so the bot reacts at once
        self.equity_written = 0.0
        self.open_trades, self.latency_ms = 0, None

    def free_cash(self, state):
        """Money a new trade may use: the account minus what open trades already hold.
        Live, it is also never more than the USDT actually free on Binance."""
        committed = sum(p["qty"] * p["entry"] for p in state["positions"].values())
        cash = self.args.account - committed
        if MODE == "live":
            cash = min(cash, self.ex.fetch_balance()["free"].get("USDT", 0.0))
        return max(cash, 0.0)

    def prices(self):
        """Latest price of every coin in one light request; also measures how fast Binance answers."""
        t0 = time.perf_counter()
        try:
            last = self.ex.fetch_last_prices(pt.SYMBOLS)
            out = {s: float(last[s]["price"]) for s in pt.SYMBOLS}
        except (AttributeError, KeyError, TypeError, ccxt.NotSupported):
            out = {s: float(self.ex.fetch_ticker(s)["last"]) for s in pt.SYMBOLS}
        self.latency_ms = round((time.perf_counter() - t0) * 1000)
        return out

    def next_wait(self, now=None):
        """Seconds until the next check: every 15 s while a trade is open, else every minute,
        and always wake 2 seconds after the daily close so orders go in right away."""
        now = now or datetime.now(timezone.utc)
        base = FAST_SECONDS if self.open_trades else LOOP_SECONDS
        if self.errors:
            base = min(LOOP_SECONDS * (2 ** (self.errors - 1)), 900)  # back off while something is failing
        close = (now + pd.Timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return max(0.5, min(base, (close - now).total_seconds() + 2))

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
            tail = df.tail(150)
            hi20 = df.high.rolling(20).max().shift(1).tail(150)  # what each day's close had to beat to buy
            lo10 = df.low.rolling(10).min().shift(1).tail(150)   # what each day's close had to break to sell
            self.candles[sym] = [dict(time=int(t.timestamp()), open=r.open, high=r.high, low=r.low, close=r.close,
                                      hi20=None if pd.isna(h) else float(h), lo10=None if pd.isna(l) else float(l))
                                 for (t, r), h, l in zip(tail.iterrows(), hi20, lo10)]
        self.levels_time = time.time()

    def kill_switches(self, state):
        if (HERE / "FLATTEN").exists():
            for sym in list(state["positions"]):
                log(f"{sym}: FLATTEN, selling")
                pt.close_long(self.ex, sym, state, "FLATTEN kill switch")
            pt.save_state(state)
            # stay paused afterwards: swap FLATTEN for STOP, so Resume (or deleting STOP) restarts trading
            (HERE / "STOP").write_text("")
            (HERE / "FLATTEN").unlink(missing_ok=True)
            log("HALT: FLATTEN done, everything sold; paused until you resume")
            self.halted, self.halt_reason = True, "STOP file present"
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
        prices = self.prices()
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
                    pt.step(self.ex, sym, sig, state, self.args.account, self.args.risk, cash=self.free_cash(state))
                pt.save_state(state)
        self.write_status(state, prices, loss_today)

    def write_status(self, state, prices, loss_today):
        positions = {}
        for s, p in state["positions"].items():
            px = prices.get(s, p["entry"])
            positions[s] = dict(p, price=px, pnl_usdt=round(p["qty"] * (px - p["entry"]), 2),
                                pnl_r=round((px - p["entry"]) / max(p["entry"] - p["stop"], 1e-9), 2))
        realized = self.realized_total()
        unrealized = sum(p["pnl_usdt"] for p in positions.values())
        equity = round(self.args.account + realized + unrealized, 2)
        now = datetime.now(timezone.utc)
        status = dict(mode=MODE, updated=now.isoformat(timespec="seconds"),
                      halted=self.halted, halt_reason=self.halt_reason, prices=prices, positions=positions,
                      levels=self.levels, today_pnl_usdt=round(loss_today, 2), account=self.args.account,
                      equity=equity, realized_usdt=round(realized, 2), unrealized_usdt=round(unrealized, 2),
                      risk=self.args.risk, max_position=self.args.max_position,
                      max_daily_loss=self.args.max_daily_loss, last_error=self.last_error,
                      coins=list(pt.SYMBOLS), latency_ms=self.latency_ms,
                      check_every_s=FAST_SECONDS if positions else LOOP_SECONDS)
        self.open_trades = len(positions)
        tmp = STATUS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(status, indent=2))
        tmp.replace(STATUS_FILE)
        if EQUITY_FILE and time.time() - self.equity_written >= 900:  # one point every 15 minutes
            new = not EQUITY_FILE.exists()
            with open(EQUITY_FILE, "a", encoding="utf-8") as f:
                if new:
                    f.write("time,equity\n")
                f.write(f"{now.isoformat(timespec='seconds')},{equity}\n")
            self.equity_written = time.time()

    def realized_total(self):
        if not pt.JOURNAL_FILE.exists():
            return 0.0
        j = pd.read_csv(pt.JOURNAL_FILE)
        if "pnl_usdt" not in j or j.empty:
            return 0.0
        return float(pd.to_numeric(j.pnl_usdt, errors="coerce").fillna(0).sum())

    def run_forever(self):
        log(f"bot started: {MODE}, {len(pt.SYMBOLS)} coins, account {self.args.account:,.0f} USDT, risk {self.args.risk:.1%}, "
            f"max position {self.args.max_position:,.0f} USDT, daily loss limit {self.args.max_daily_loss:.0%}")
        _plain_log("keeping the computer awake while the bot runs" if stay_awake()
                   else "could not ask Windows to stay awake; check your sleep settings")
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
            self.wake.wait(self.next_wait())  # a dashboard button cuts this short
            self.wake.clear()


# ---------- dashboard ----------

CONTROL_ACTIONS = {
    "pause": "Pause: no new trades (open stop-losses stay on Binance)",
    "resume": "Resume: trading again",
    "flatten": "Sell everything now, then pause",
}


def tail_lines(path, n):
    if not path or not Path(path).exists():
        return []
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.readlines()[-n:]


def serve_dashboard(port, bot):
    """The dashboard at http://localhost:<port>. Only this laptop can reach it (127.0.0.1), and the
    buttons need a secret code that the bot puts into its own page, so other websites open in the
    browser cannot press them."""
    token = secrets.token_urlsafe(24)
    allowed_hosts = set()  # filled in once the server knows its real port

    class Handler(BaseHTTPRequestHandler):
        def send(self, status, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", f"{ctype}; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def json(self, obj, status=200):
            self.send(status, json.dumps(obj, default=str))

        def host_ok(self):  # blocks "DNS rebinding": a website pretending to be localhost
            return self.headers.get("Host", "") in allowed_hosts

        def do_GET(self):
            if not self.host_ok():
                return self.json({"error": "forbidden"}, 403)
            url = urlparse(self.path)
            q = parse_qs(url.query)
            if url.path in ("/", "/index.html"):
                html = (HERE / "dashboard.html").read_text(encoding="utf-8").replace("__BOT_TOKEN__", token)
                return self.send(200, html, "text/html")
            if url.path == "/api/status":
                return self.send(200, STATUS_FILE.read_text() if STATUS_FILE.exists() else "{}")
            if url.path == "/api/journal":
                rows = pd.read_csv(pt.JOURNAL_FILE).fillna("").to_dict("records") if pt.JOURNAL_FILE.exists() else []
                return self.json(rows)
            if url.path == "/api/activity":
                n = min(int(q.get("n", ["300"])[0]), 2000)
                lines = [l.rstrip("\n").split("\t", 1) for l in tail_lines(ACTIVITY_FILE, n)]
                return self.json([{"time": a, "msg": b} for a, b in (l for l in lines if len(l) == 2)])
            if url.path == "/api/equity":
                rows = [l.strip().split(",") for l in tail_lines(EQUITY_FILE, 20000)[1:] if "," in l]
                return self.json([{"time": t, "equity": float(e)} for t, e in rows])
            if url.path == "/api/candles":
                return self.json(bot.candles.get(q.get("symbol", [""])[0], []))
            return self.json({"error": "not found"}, 404)

        def do_POST(self):
            raw = self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 1000))  # read first, refuse cleanly
            if not self.host_ok() or not secrets.compare_digest(self.headers.get("X-Bot-Token", ""), token):
                return self.json({"error": "forbidden"}, 403)
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc not in allowed_hosts:
                return self.json({"error": "forbidden"}, 403)
            if urlparse(self.path).path != "/api/control":
                return self.json({"error": "not found"}, 404)
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                return self.json({"error": "bad request"}, 400)
            action = body.get("action")
            if action not in CONTROL_ACTIONS:
                return self.json({"error": "unknown action"}, 400)
            if action == "pause":
                (HERE / "STOP").write_text("")
            elif action == "resume":
                (HERE / "STOP").unlink(missing_ok=True)
                (HERE / "FLATTEN").unlink(missing_ok=True)
            elif action == "flatten":
                (HERE / "FLATTEN").write_text("")
            _plain_log(f"dashboard button: {CONTROL_ACTIONS[action]}")
            bot.wake.set()  # act now instead of at the next minute
            return self.json({"ok": True, "action": action})

        def log_message(self, *a):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    port = server.server_address[1]
    allowed_hosts.update({f"localhost:{port}", f"127.0.0.1:{port}"})
    threading.Thread(target=server.serve_forever, daemon=True).start()
    _plain_log(f"dashboard: http://localhost:{port}")
    return server, token


def main():
    global MODE
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["testnet", "live"], default="testnet")
    ap.add_argument("--account", type=float, default=1000.0, help="account size the bot may use, USDT (default 1000)")
    ap.add_argument("--coins", nargs="+", default=COINS, metavar="COIN",
                    help=f"coins to trade against USDT (default: {' '.join(COINS)})")
    ap.add_argument("--risk", type=float, default=0.003, help="fraction of account lost if a stop is hit (default 0.003)")
    ap.add_argument("--max-position", type=float, default=200.0, help="largest single position, USDT (default 200)")
    ap.add_argument("--max-daily-loss", type=float, default=0.03, help="halt for the day after this loss (default 0.03)")
    ap.add_argument("--port", type=int, default=8077, help="dashboard port")
    args = ap.parse_args()
    if args.risk > 0.03:
        raise SystemExit("--risk above 3% per trade is not allowed.")

    global ACTIVITY_FILE, EQUITY_FILE
    MODE = args.mode
    ACTIVITY_FILE, EQUITY_FILE = HERE / f"{MODE}_activity.log", HERE / f"{MODE}_equity.csv"
    pt.SYMBOLS = [f"{c.upper()}/USDT" for c in args.coins]
    pt.MAX_POSITION_USDT = args.max_position
    pt.STATE_FILE = HERE / f"{MODE}_state.json"
    pt.JOURNAL_FILE = HERE / f"{MODE}_journal.csv"
    ex = live_exchange() if MODE == "live" else pt.testnet_exchange()
    missing = [s for s in pt.SYMBOLS if s not in ex.markets]
    if missing:
        raise SystemExit(f"Not tradable on Binance {MODE}: {', '.join(missing)}")
    if args.account < 500 and len(pt.SYMBOLS) > 2:
        _plain_log(f"note: with {args.account:,.0f} USDT some trades will be under Binance's 5 USDT minimum and get skipped; "
                   f"500+ USDT is better for {len(pt.SYMBOLS)} coins")
    bot = Bot(ex, public_data(), args)
    serve_dashboard(args.port, bot)
    bot.run_forever()


if __name__ == "__main__":
    main()

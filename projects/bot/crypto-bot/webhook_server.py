"""Receive TradingView alerts and place the orders on the Binance spot TESTNET.

TradingView sends a POST to /webhook when an alert fires. The body must be JSON:

    {"secret": "<WEBHOOK_SECRET>", "action": "buy", "symbol": "BTCUSDT", "stop_dist": 4186.5}
    {"secret": "<WEBHOOK_SECRET>", "action": "sell", "symbol": "BTCUSDT"}

The fields may also be nested under "order" (that is what the Pine script's
{{strategy.order.alert_message}} produces). `stop_dist` is the distance from entry
to stop-loss in price units; if it is missing, 2 x daily ATR is used.

Buys place a market order plus a STOP_LOSS order on the exchange, exactly like
paper_trader.py. Duplicate alerts are ignored (no second buy while in a trade).
Every 5 minutes the server checks whether an exchange stop has filled.

    setx WEBHOOK_SECRET "a-long-random-phrase"     (plus the two testnet keys)
    python webhook_server.py --dry-run             # log what it would do, no keys needed
    python webhook_server.py                       # listen on http://localhost:8080/webhook

TradingView can only reach a public HTTPS address on port 443, so expose the
port with a tunnel such as `ngrok http 8080` and use https://<ngrok-host>/webhook.
"""
import argparse
import hmac
import json
import os
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ccxt

import paper_trader as pt
from strategies import donchian_breakout

ALLOWED = {"BTCUSDT": "BTC/USDT", "ETHUSDT": "ETH/USDT"}
# Addresses TradingView sends webhooks from (tradingview.com/support/solutions/43000529348)
TRADINGVIEW_IPS = {"52.89.214.238", "34.212.75.30", "54.218.53.128", "52.32.178.7"}
MAX_BODY = 10_000
STOP_CHECK_SECONDS = 300

pt.STATE_FILE = pt.HERE / "webhook_state.json"
pt.JOURNAL_FILE = pt.HERE / "webhook_journal.csv"


def parse_alert(body, secret):
    """Validate an alert body. Returns (order dict, None) or (None, (http status, error))."""
    try:
        data = json.loads(body)
    except ValueError:
        return None, (400, "body is not valid JSON")
    if not isinstance(data, dict):
        return None, (400, "body must be a JSON object")
    if not hmac.compare_digest(str(data.get("secret", "")), secret):
        return None, (401, "wrong or missing secret")
    order = {**data, **data["order"]} if isinstance(data.get("order"), dict) else data
    action = str(order.get("action", "")).lower()
    if action not in ("buy", "sell"):
        return None, (400, "action must be 'buy' or 'sell'")
    ticker = str(order.get("symbol", "")).upper().split(":")[-1].replace("/", "")
    if ticker not in ALLOWED:
        return None, (400, f"symbol must be one of {sorted(ALLOWED)}")
    stop_dist = order.get("stop_dist")
    if stop_dist is not None:
        try:
            stop_dist = float(stop_dist)
        except (TypeError, ValueError):
            return None, (400, "stop_dist must be a number")
        if stop_dist <= 0:
            return None, (400, "stop_dist must be positive")
    return {"action": action, "symbol": ALLOWED[ticker], "stop_dist": stop_dist,
            "comment": str(order.get("comment", ""))[:60]}, None


class Bridge:
    """Runs alerts one at a time against the exchange and keeps the state file in sync."""

    def __init__(self, ex, market_data, account, risk, dry_run):
        self.ex, self.market_data = ex, market_data
        self.account, self.risk, self.dry_run = account, risk, dry_run
        self.lock = threading.Lock()
        self.jobs = queue.Queue()

    def handle(self, alert):
        symbol = alert["symbol"]
        with self.lock:
            state = pt.load_state()
            if not self.dry_run and not pt.check_stop(self.ex, symbol, state):
                pt.save_state(state)
                return
            pos = state["positions"].get(symbol)
            reason = "TradingView " + (alert["comment"] or alert["action"])
            if alert["action"] == "buy":
                if pos:
                    pt.log(f"{symbol}: buy alert ignored, already in a trade since {pos['entry_time']}")
                else:
                    stop_dist = alert["stop_dist"] or self.default_stop_dist(symbol)
                    pt.open_long(self.ex, symbol, state, self.account, self.risk, stop_dist, reason,
                                 pt.datetime.now(pt.timezone.utc).isoformat(timespec="minutes"), self.dry_run)
            elif pos:
                pt.close_long(self.ex, symbol, state, reason, self.dry_run)
            else:
                pt.log(f"{symbol}: sell alert ignored, no open trade")
            if not self.dry_run:
                pt.save_state(state)

    def default_stop_dist(self, symbol):
        sig = donchian_breakout(pt.daily_candles(self.market_data, symbol))
        pt.log(f"{symbol}: alert had no stop_dist, using 2 x daily ATR")
        return float(sig.stop_dist.iloc[-1])

    def worker(self):
        while True:
            alert = self.jobs.get()
            try:
                self.handle(alert)
            except ccxt.BaseError as e:
                pt.log(f"{alert['symbol']}: exchange error, alert NOT executed: {e}")
            except Exception as e:  # keep the server alive whatever happens
                pt.log(f"{alert['symbol']}: unexpected error, alert NOT executed: {e!r}")

    def stop_monitor(self, stop_event):
        while not stop_event.wait(STOP_CHECK_SECONDS):
            with self.lock:
                try:
                    state = pt.load_state()
                    for symbol in list(state["positions"]):
                        pt.check_stop(self.ex, symbol, state)
                    pt.save_state(state)
                except Exception as e:
                    pt.log(f"stop check failed, will retry: {e!r}")


def make_handler(bridge, secret, tv_ips_only):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def client_ip(self):
            forwarded = self.headers.get("X-Forwarded-For")  # set by ngrok and other tunnels
            return forwarded.split(",")[0].strip() if forwarded else self.client_address[0]

        def do_GET(self):
            self.reply(200, {"ok": True, "service": "tradingview-testnet-bridge", "dry_run": bridge.dry_run})

        def do_POST(self):
            if self.path.rstrip("/") != "/webhook":
                return self.reply(404, {"ok": False, "error": "use /webhook"})
            ip = self.client_ip()
            if tv_ips_only and ip not in TRADINGVIEW_IPS:
                pt.log(f"rejected alert from {ip}: not a TradingView address")
                return self.reply(403, {"ok": False, "error": "forbidden"})
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self.reply(413, {"ok": False, "error": "body too large"})
            alert, err = parse_alert(self.rfile.read(length).decode("utf-8", "replace"), secret)
            if err:
                pt.log(f"rejected alert from {ip}: {err[1]}")
                return self.reply(err[0], {"ok": False, "error": err[1]})
            pt.log(f"alert from {ip}: {alert['action'].upper()} {alert['symbol']} stop_dist={alert['stop_dist']}")
            bridge.jobs.put(alert)  # reply at once; TradingView gives up after ~3 seconds
            self.reply(200, {"ok": True, "queued": alert})

        def log_message(self, *args):  # silence the default per-request log line
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--account", type=float, default=1000.0, help="virtual account size in USDT (default 1000)")
    ap.add_argument("--risk", type=float, default=0.01, help="fraction of account lost if the stop is hit (default 0.01)")
    ap.add_argument("--dry-run", action="store_true", help="log orders instead of placing them; no keys needed")
    ap.add_argument("--tv-ips-only", action="store_true", help="only accept requests from TradingView's IP addresses")
    args = ap.parse_args()

    secret = os.getenv("WEBHOOK_SECRET", "")
    if len(secret) < 12:
        raise SystemExit("Set WEBHOOK_SECRET to a random phrase of 12+ characters first (see top of this file).")
    market_data = ccxt.binance({"enableRateLimit": True})
    if args.dry_run:
        market_data.load_markets()
        ex = market_data
    else:
        ex = pt.testnet_exchange()

    bridge = Bridge(ex, market_data, args.account, args.risk, args.dry_run)
    threading.Thread(target=bridge.worker, daemon=True).start()
    stop_event = threading.Event()
    if not args.dry_run:
        threading.Thread(target=bridge.stop_monitor, args=(stop_event,), daemon=True).start()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(bridge, secret, args.tv_ips_only))
    mode = "DRY-RUN (no orders)" if args.dry_run else "TESTNET orders"
    pt.log(f"listening on http://localhost:{args.port}/webhook, {mode}, ${args.account:,.0f} account, {args.risk:.0%} risk")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pt.log("shutting down")
    finally:
        stop_event.set()
        server.server_close()


if __name__ == "__main__":
    main()

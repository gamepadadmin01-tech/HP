"""Download historical OHLCV candles for BTC, ETH and a stablecoin pair.

Uses public exchange endpoints through ccxt, so no API key is needed.
Tries several exchanges in order and uses the first one that responds.

    python fetch_data.py            # daily + 4h candles since 2018
"""
import time
from pathlib import Path

import ccxt
import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
EXCHANGES = ["binance", "bybit", "okx", "kraken"]
SYMBOLS = ["BTC/USDT", "ETH/USDT", "USDC/USDT"]
TIMEFRAMES = ["1d", "4h"]
START = "2018-01-01T00:00:00Z"
MIRROR = "https://data-api.binance.vision/api/v3"  # Binance's public market-data mirror


def binance(mirror=False, **config):
    """A Binance SPOT connection. ccxt otherwise also loads the futures servers, which
    time out from some networks and stall everything. mirror=True reads public prices
    (candles, tickers) from Binance's market-data mirror, which is reachable more reliably."""
    ex = ccxt.binance({"enableRateLimit": True, "timeout": 20000,
                       "options": {"fetchMarkets": {"types": ["spot"]}}, **config})
    if mirror:
        ex.urls["api"]["public"] = MIRROR
    return ex


def pick_exchange():
    for name in EXCHANGES:
        try:
            ex = binance(mirror=True) if name == "binance" else getattr(ccxt, name)({"enableRateLimit": True})
            ex.load_markets()
            if all(s in ex.markets for s in SYMBOLS[:2]):
                print(f"Using exchange: {name}")
                return ex
        except Exception as e:  # geo-blocked, offline, etc.
            print(f"{name} unavailable: {type(e).__name__}")
    raise SystemExit("No exchange reachable.")


def fetch(ex, symbol, timeframe, start=START):
    since = ex.parse8601(start)
    rows = []
    while True:
        batch = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=1000)
        if not batch:
            break
        rows += batch
        since = batch[-1][0] + 1
        if len(batch) < 2 or batch[-1][0] >= ex.milliseconds() - ex.parse_timeframe(timeframe) * 1000:
            break
        time.sleep(ex.rateLimit / 1000)
    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    return df.drop_duplicates("time").set_index("time")


def main():
    DATA_DIR.mkdir(exist_ok=True)
    ex = pick_exchange()
    for symbol in SYMBOLS:
        if symbol not in ex.markets:
            print(f"skip {symbol}: not listed on {ex.id}")
            continue
        for tf in TIMEFRAMES:
            df = fetch(ex, symbol, tf)
            out = DATA_DIR / f"{symbol.replace('/', '')}_{tf}.csv"
            df.to_csv(out)
            print(f"{symbol} {tf}: {len(df)} candles {df.index[0].date()} -> {df.index[-1].date()}")


if __name__ == "__main__":
    main()

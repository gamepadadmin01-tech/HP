"""Build simulator.html: the practice simulator with hourly BTC/ETH candles embedded.

Downloads hourly candles since 2020 (if data/*_1h.csv is missing or --refresh is
given), then writes one self-contained HTML file you can open in any browser.

    python build_simulator.py            # build from existing data
    python build_simulator.py --refresh  # download the latest candles first
"""
import argparse
import json
from pathlib import Path

import pandas as pd

import fetch_data

HERE = Path(__file__).parent
COINS = {"BTC": ("BTC/USDT", 1), "ETH": ("ETH/USDT", 2)}  # symbol, decimals kept
START = "2020-01-01T00:00:00Z"


def download(symbol):
    return fetch_data.fetch(fetch_data.binance(mirror=True), symbol, "1h", START)


def encode(df, decimals):
    secs = df.index.as_unit("s").asi8  # pandas may store us or ns; normalise to seconds
    t0 = int(secs[0])
    return {
        "t0": t0,
        "t": ((secs - t0) // 3600).astype(int).tolist(),
        **{k[0]: df[k].round(decimals).tolist() for k in ("open", "high", "low", "close")},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="download the latest hourly candles first")
    args = ap.parse_args()

    raw = {}
    for coin, (symbol, decimals) in COINS.items():
        path = fetch_data.DATA_DIR / f"{symbol.replace('/', '')}_1h.csv"
        if args.refresh or not path.exists():
            fetch_data.DATA_DIR.mkdir(exist_ok=True)
            download(symbol).to_csv(path)
        df = pd.read_csv(path, index_col="time", parse_dates=True).loc[START[:10]:]
        raw[coin] = encode(df, decimals)
        print(f"{coin}: {len(df):,} hourly candles, {df.index[0].date()} -> {df.index[-1].date()}")

    html = (HERE / "simulator_template.html").read_text(encoding="utf-8")
    html = html.replace("/*__DATA__*/null", json.dumps(raw, separators=(",", ":")))
    out = HERE / "simulator.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out.name} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

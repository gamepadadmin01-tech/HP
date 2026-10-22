"""Load candle CSVs exported from TradingView.

In TradingView: open the chart (e.g. BINANCE:BTCUSDT, 1D), click the arrow next to the
layout name (top right) -> "Download chart data", and save the CSV into data/tradingview/.
Either time format ("ISO time" or "UNIX timestamp") works.

Files are matched by name, so "BINANCE_BTCUSDT, 1D.csv" is used for BTC daily.
"""
from pathlib import Path

import pandas as pd

TV_DIR = Path(__file__).parent / "data" / "tradingview"
TF_NAMES = {"1d": ["1D", "D"], "4h": ["240", "4H"], "1h": ["60", "1H"]}


def load_tv_csv(path):
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    missing = {"time", "open", "high", "low", "close"} - set(df.columns)
    if missing:
        raise ValueError(f"{Path(path).name}: not a TradingView export (missing {sorted(missing)})")
    t = df["time"]
    if pd.api.types.is_numeric_dtype(t):
        idx = pd.to_datetime(t, unit="s", utc=True)
    else:
        idx = pd.to_datetime(t, utc=True)
    out = df[["open", "high", "low", "close"]].astype(float)
    out["volume"] = df["volume"].astype(float) if "volume" in df else 0.0
    out.index = idx.rename("time")
    return out[~out.index.duplicated()].sort_index().dropna()


def find_tv_file(coin, tf):
    """Return the TradingView CSV for e.g. coin='BTC', tf='1d', or None."""
    if not TV_DIR.exists():
        return None
    for f in sorted(TV_DIR.glob("*.csv")):
        name = f.stem.upper().replace(" ", "")
        if f"{coin}USDT" in name and any(name.endswith("," + n) or name.endswith("_" + n) for n in TF_NAMES[tf]):
            return f
    return None


def load_candles(coin, tf, data_dir=Path(__file__).parent / "data"):
    """TradingView export if one exists, otherwise the Binance download. Returns (df, source)."""
    tv = find_tv_file(coin, tf)
    if tv:
        return load_tv_csv(tv), f"TradingView export ({tv.name})"
    df = pd.read_csv(data_dir / f"{coin}USDT_{tf}.csv", index_col="time", parse_dates=True)
    return df, f"Binance ({coin}USDT_{tf}.csv)"

"""Build results/report.html from the output of run_backtests.py."""
import base64
import io
from html import escape
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

RESULTS = Path(__file__).parent / "results"
COLORS = {"Buy & hold": "#9a9a9a", "Trend (EMA 20/50 + 200 filter)": "#2a78d6",
          "Breakout (Donchian 20/10)": "#1f9d6b", "Dip-buy (RSI pullback in uptrend)": "#d9822b"}

RULES = [
    ("Breakout (Donchian 20/10)", "Daily close above the previous 20-day high",
     "Daily close below the previous 10-day low", "2 × ATR(14) below entry"),
    ("Trend (EMA 20/50 + 200 filter)", "EMA20 crosses above EMA50 while price is above EMA200",
     "EMA20 crosses below EMA50", "3 × ATR below entry, trailed 3 × ATR under the highest close"),
    ("Dip-buy (RSI pullback in uptrend)", "Price above SMA200 and RSI(14) drops below 40",
     "RSI(14) above 65, or after 15 days", "2.5 × ATR below entry"),
]


def chart(curves, coin, period):
    fig, ax = plt.subplots(figsize=(9, 4.2), dpi=110)
    for (c, p, name), eq in curves.items():
        if c == coin and p == period:
            ax.plot(eq.index, eq.values, label=name, color=COLORS[name], lw=2 if name != "Buy & hold" else 1.4)
    ax.set_yscale("log")
    ax.set_title(f"{coin[:3]}: $10,000 traded all-in, {period} (log scale)", fontsize=11, loc="left")
    ax.grid(alpha=0.25)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(fontsize=8, frameon=False)
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def pct(v, signed=True):
    return "" if pd.isna(v) else (f"{v:+.0%}" if signed else f"{v:.0%}")


def table(df):
    head = "<tr><th>Coin</th><th>Strategy</th><th>Sizing</th><th>Total return</th><th>Per year</th>" \
           "<th>Worst drop</th><th>Trades</th><th>Win rate</th><th>Avg win / loss</th></tr>"
    body = []
    for _, r in df.iterrows():
        wl = "" if pd.isna(r["Avg win"]) else f"{pct(r['Avg win'])} / {pct(r['Avg loss'])}"
        cls = ' class="bh"' if r.strategy == "Buy & hold" else ""
        trades = "" if pd.isna(r.Trades) else int(r.Trades)
        body.append(f"<tr{cls}><td>{r.coin[:3]}</td><td>{escape(r.strategy)}</td><td>{r.sizing}</td>"
                    f"<td>{pct(r['Total return'])}</td><td>{pct(r.CAGR)}</td><td>{pct(r['Max drawdown'])}</td>"
                    f"<td>{trades}</td><td>{pct(r['Win rate'], False)}</td><td>{wl}</td></tr>")
    return f"<table>{head}{''.join(body)}</table>"


def main():
    s = pd.read_csv(RESULTS / "summary.csv")
    curves = pd.read_pickle(RESULTS / "curves.pkl")
    full = s[s.period == "Full 2018-now"]
    oos = s[s.period == "2023-now (out-of-sample)"]
    rules = "".join(f"<tr><td><b>{escape(n)}</b></td><td>{e}</td><td>{x}</td><td>{st}</td></tr>" for n, e, x, st in RULES)
    charts = "".join(f'<img alt="{c} equity curve" src="data:image/png;base64,{chart(curves, c, "Full 2018-now")}">'
                     for c in ["BTCUSDT", "ETHUSDT"])
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Crypto Strategy Backtest</title>
<style>
:root {{ --bg:#fbfaf8; --fg:#1d1d1f; --muted:#666; --line:#e4e1dc; --card:#fff; --accent:#1f9d6b; --warn:#b5541b; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#16171a; --fg:#ececec; --muted:#a0a0a0; --line:#2e3036; --card:#1e2024; --accent:#4cc79a; --warn:#f0a06b; }} }}
body {{ background:var(--bg); color:var(--fg); font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif; margin:0; padding:24px 16px 64px; }}
main {{ max-width:960px; margin:auto; }}
h1 {{ font-size:26px; margin:0 0 4px; }} h2 {{ font-size:18px; margin:36px 0 10px; }}
.sub {{ color:var(--muted); margin:0 0 24px; }}
.callout {{ background:var(--card); border:1px solid var(--line); border-left:4px solid var(--accent); padding:14px 18px; border-radius:8px; }}
.warn {{ border-left-color:var(--warn); }}
.scroll {{ overflow-x:auto; }}
table {{ border-collapse:collapse; width:100%; font-size:13.5px; background:var(--card); }}
th, td {{ text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; }}
th {{ font-weight:600; color:var(--muted); }}
tr.bh td {{ color:var(--muted); font-style:italic; }}
img {{ width:100%; height:auto; background:#fff; border-radius:8px; margin:8px 0; }}
code {{ background:var(--card); border:1px solid var(--line); padding:1px 5px; border-radius:4px; }}
li {{ margin:4px 0; }}
</style></head><body><main>
<h1>Crypto strategy backtest: BTC &amp; ETH</h1>
<p class="sub">Binance daily candles, Jan 2018 – Oct 2026. Fees 0.1% + 0.05% slippage per fill. Long-only spot, no leverage.</p>

<div class="callout"><b>Bottom line.</b> The <b>Breakout</b> strategy did best on both coins over the full period and stayed
profitable in the 2023-now test period that its rules were not fitted to. Its main benefit was <b>smaller crashes</b>:
BTC's worst drop was −48% versus −81% for simply holding. It did <b>not</b> beat buy-and-hold since 2023, a strong bull
market for BTC. The dip-buy strategy roughly broke even and is not worth trading as is.</div>

<h2>The rules: when to buy, when to sell, where the stop goes</h2>
<p>All signals use the <b>daily close</b>; the order is placed at the next day's open. ATR is the average daily price range over 14 days.</p>
<div class="scroll"><table><tr><th>Strategy</th><th>Buy when</th><th>Sell when</th><th>Stop-loss</th></tr>{rules}</table></div>

<h2>Results, full period (2018 – now)</h2>
<p><b>All-in</b> puts 100% of the account in every trade. <b>2% risk</b> sizes each trade so hitting the stop loses 2% of the account; returns are smaller, and so are the drops.</p>
<div class="scroll">{table(full)}</div>
{charts}

<h2>Out-of-sample check (2023 – now)</h2>
<p>The rules use standard textbook settings and were not tuned. This period shows how they did on recent data.</p>
<div class="scroll">{table(oos)}</div>

<h2>Stablecoins (USDT, USDC)</h2>
<p>Stablecoins are pegged to $1, and USDC/USDT stayed within about 0.1% of 1.00 over the last month, so there is no price move to trade.
Use them as the <b>cash side</b> of BTC/USDT and ETH/USDT trades: when a strategy is out of the market, the money sits in USDT or USDC.</p>

<h2>How to use this</h2>
<ol>
<li>Run <code>python signals.py --account 1000 --risk 0.01</code> once a day after the daily candle closes (05:30 IST). It prints BUY / HOLD / SELL / WAIT for each strategy with the exact stop-loss price and position size.</li>
<li>Paste <code>pine/breakout_donchian.pine</code> into TradingView's Pine Editor on a BTCUSDT 1D chart to see the trades and set alerts.</li>
<li>Paper trade for at least a few weeks before using real money, and compare the fills with this report.</li>
</ol>

<div class="callout warn"><b>Limits of this test.</b> A backtest is not a forecast. These results depend heavily on the 2020–21 and 2024 bull runs.
Most of each strategy's profit comes from a few big winners, so a missed signal or a run of small losses is normal.
Win rates are 40–50%, so expect losing streaks. This is a systematic test of public rules, not financial advice.</div>
</main></body></html>"""
    out = RESULTS / "report.html"
    out.write_text(html, encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()

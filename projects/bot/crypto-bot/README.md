# crypto-bot

## Running the bot for real: `live_bot.py`

`live_bot.py` is the one to run day to day. It runs nonstop: every minute it reads prices,
checks each trade's stop-loss on the exchange and updates the dashboard; right after each daily
close (00:00 UTC = 05:30 IST) it applies the Breakout rules and places orders. Every buy gets a
stop-loss order **on Binance**, so the stop protects you even if your laptop is off.

**No terminal needed — double-click these, in order:**
1. `setup_keys.bat` — saves your testnet keys (and optional Telegram alerts) on this PC.
2. `start_bot.bat` — starts the bot on the testnet; it restarts itself if it ever stops.
3. Open http://localhost:8077 in your browser for the dashboard (prices, open trades, stops,
   today's P&L, how far each coin is from a buy signal, trade log).
4. Optional: `install_autostart.bat` makes the bot start by itself whenever you log in to Windows;
   `remove_autostart.bat` undoes that.

Your own limits can be passed to the launcher, e.g. `start_bot.bat --account 500 --max-position 150`.

**Safety built in**
- `--max-position` caps any single position (default 200 USDT); `--risk` is capped at 3% per trade.
- `--max-daily-loss` (default 3%) halts new trades for the rest of the UTC day.
- Create a file named `STOP` in this folder to block new trades; `FLATTEN` sells everything and halts.
- On first start it waits for the next daily close instead of acting on an old signal.
- Network errors never crash it: it retries with back-off and alerts you after 3 failures.
- Telegram alerts for every buy, sell, stop-out, halt and error: set `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_CHAT_ID` (create a bot with @BotFather, get your chat id from @userinfobot).

**Go-live checklist** (real money; do these in order)
1. Run on testnet (`start_bot.bat`) for at least 4 weeks. Check the dashboard and journal match what the
   rules should have done, and that stop-outs show up correctly.
2. On Binance, create an API key with **only "Spot & Margin Trading"** enabled, **withdrawals disabled**,
   and restricted to your IP. The bot refuses to start with a key that can withdraw.
3. Start small: `--account` set to money you can afford to lose entirely, `--max-position` well below it.
4. Set the live variables yourself (never paste keys into chat):
   ```
   setx BINANCE_LIVE_API_KEY "..."
   setx BINANCE_LIVE_SECRET "..."
   setx LIVE_TRADING_CONFIRM "I_ACCEPT_REAL_MONEY_RISK"
   ```
5. Open a new terminal: `start_bot.bat --mode live --account 300 --max-position 100`.
   The dashboard badge turns red **LIVE**.

**Keeping it running:** the laptop must stay on, awake and online (Settings → System → Power → Sleep:
Never while plugged in). `install_autostart.bat` brings the bot back after a restart.
For true 24/7 operation, run it on a small always-on cloud server instead of a laptop.
Testnet and live keep separate files: `testnet_state.json` / `live_state.json` and `*_journal.csv`.

`python test_live_bot.py` checks the live loop offline (fake exchange).

Rule-based BTC/ETH strategies with entry, exit and stop-loss rules, backtested on Binance daily data since 2018.

| File | What it does |
|---|---|
| `fetch_data.py` | Downloads daily + 4h candles for BTC/USDT, ETH/USDT, USDC/USDT into `data/` (no API key) |
| `strategies.py` | The three strategies: Breakout, Trend, Dip-buy |
| `backtest.py` | Simulator: next-open fills, intrabar stops, 0.1% fee + 0.05% slippage |
| `run_backtests.py` | Runs every strategy × coin × period → `results/summary.csv`, trade logs |
| `report.py` | Builds `results/report.html` |
| `signals.py` | Today's BUY / HOLD / SELL / WAIT with stop-loss price and position size |
| `pine/*.pine` | The same strategies for TradingView |

```bash
pip install ccxt pandas matplotlib
python fetch_data.py
python run_backtests.py
python report.py
python signals.py --account 1000 --risk 0.01
```

Run `signals.py` after the daily candle closes (00:00 UTC = 05:30 IST). Paper trade before using real money.

## Using TradingView data

TradingView doesn't store chart history on your PC. To use its candles, export them:
chart → arrow next to the layout name → **Download chart data**, and save the CSV into
`data/tradingview/` (keep TradingView's file name, e.g. `BINANCE_BTCUSDT, 1D.csv`).
`rl_agent.py` then uses it automatically instead of the Binance download (`tradingview_data.py`).

## Reward-trained bot (reinforcement learning)

`rl_agent.py` learns by trial and error: every trade earns its result in R (profit ÷ amount risked),
so a good trade is a positive reward and a stopped-out trade is about −1. A 2×ATR stop is always on.
It trains on 2018–2022 and is tested once on 2023–now, over several random seeds.

```
python rl_agent.py --learn entries          # learn when to buy; exits follow the Breakout rule (best)
python rl_agent.py --learn all              # learn buys and sells (overtrades, weak)
python rl_agent.py --tf 4h --learn entries --episodes 150 --runs 5
```

Findings so far (Oct 2026):
- Learning every buy/sell decision did **worse** than the simple rules: ~6× more trades, winners cut short.
- Learning only entries beat the rules on the 2023–now test in 3 of 4 cases, but mostly by being in the
  market far more (68–75% vs 36–47% of days) during a bull market. Per day held it is no better on BTC;
  ETH daily is the one real improvement. It is **not** ready to replace the Breakout rules.
- Results are saved to `results/rl_results_*.csv`; learned buy conditions to `results/rl_policy_*.json`.

**Walk-forward verdict (`python walk_forward.py --tf 1d`):** retrained on each rolling 3-year window and
tested on the following year, 2021–2026, BTC and ETH, 5 seeds each. The pass rules were fixed in advance.

| | Learned beats rules | Per candle held | Worst seed beats rules | Compounded, learned vs rules |
|---|---|---|---|---|
| Daily | 6/12 | 7/12 | 5/12 | +51% vs +50% |
| 4-hour | 6/12 | 6/12 | 2/12 | +146% vs +158% |

**Not reliably better** — a coin flip on both timeframes. The learned agent wins in bull years by staying
in the market longer and loses it back in falling years (2022: in the market ~70% of days vs ~15% for the
rules). Keep the Breakout rules for trading. Per-year detail: `results/walk_forward_*.csv`.

**More training makes it worse, not better** (daily, 3 seeds): from 100 to 3,000 training rounds the
win rate on its training years rose 38% → 44% and the average trade +1.02R → +1.59R, while on unseen
years it stayed at ~30% and +0.3–0.45R, and the compounded result fell below the rules (+38% vs +50%).
That is overfitting: it memorises the past instead of learning something that repeats.

## Practice simulator

`simulator.html` replays real BTC/ETH history (hourly candles since 2020) one candle at a time,
with the future hidden, so you can practise entries, stop-losses and exits with a fake $10,000.
Open it in any browser (double-click). It needs internet once to load the chart library.

- **Random start** drops you at a surprise date so you can't remember what happened next.
- Pick 1h, 4h or 1d candles. `→` next candle, `Space` play/pause, `B` buy, `C` close.
- Every buy needs a stop-loss; size is set so the stop loses 0.5/1/2% of your account. Optional 1R/2R/3R target.
- **Coach** shows what the Breakout rules would do on the same chart (purple dots), and flags habits
  like moving a stop further away.
- **End session** shows a summary (you vs the bot vs buy & hold) and adds it to the **training log**,
  which counts your simulated hours, real practice time and trades. The log is saved in that browser.

To add the latest candles: `python build_simulator.py --refresh`.

## Paper trading on Binance testnet

`paper_trader.py` trades the Breakout strategy automatically with fake money on the
[Binance spot testnet](https://testnet.binance.vision). Signals use real Binance prices;
orders, fills and stop-losses happen on the testnet.

1. Go to https://testnet.binance.vision, log in with GitHub, and click **Generate HMAC_SHA256 Key**.
2. Save the key and secret as environment variables (then open a new terminal):
   ```
   setx BINANCE_TESTNET_API_KEY "your-key"
   setx BINANCE_TESTNET_SECRET "your-secret"
   ```
3. Run it:
   ```
   python paper_trader.py --dry-run     # preview, no keys or orders
   python paper_trader.py --loop        # trade now, then 5 min after every daily close
   ```
   `--account 1000 --risk 0.01` is the default: a virtual $1,000 account risking 1% per trade.

On a buy it places a **stop-loss order on the exchange**, so the stop works even while the
script is not running. Positions are kept in `paper_state.json`; every fill goes to
`paper_journal.csv`. `python test_paper_trader.py` checks the order logic offline.

The testnet is wiped roughly once a month; the bot notices the missing stop order and starts fresh.

## TradingView → testnet (webhook bridge)

`webhook_server.py` lets TradingView decide: when your strategy fills an order on the
chart, TradingView sends an alert to your PC and the bridge places the matching testnet
order (market buy + exchange stop-loss, or cancel stop + market sell).

Use **either** this **or** `paper_trader.py`, not both: they trade the same testnet account.

**You need:** a TradingView plan that includes webhook alerts, 2-factor authentication
turned on in TradingView (webhooks are blocked without it), your testnet keys from above,
and a free [ngrok](https://ngrok.com) account.

1. Pick a secret phrase (12+ random characters) and save it:
   ```
   setx WEBHOOK_SECRET "your-random-phrase"
   ```
2. Start the bridge in a new terminal:
   ```
   python webhook_server.py --tv-ips-only
   ```
   (`--dry-run` logs instead of ordering; `--tv-ips-only` rejects anything not from TradingView's servers.)
3. In a second terminal, expose it: `ngrok http 8080`. Copy the `https://….ngrok-free.app` address.
4. In TradingView, open a **BINANCE:BTCUSDT** daily chart, paste `pine/breakout_donchian.pine` into the
   Pine Editor and click **Add to chart**.
5. Create an alert: Condition = *Breakout (Donchian 20/10)* → **Order fills only**.
   On the Notifications tab, enable **Webhook URL**: `https://<your-ngrok-address>/webhook`.
   Message:
   ```
   {"secret": "your-random-phrase", "order": {{strategy.order.alert_message}}}
   ```
6. Repeat 4–5 on a **BINANCE:ETHUSDT** daily chart.

Fills go to `webhook_journal.csv`, open positions to `webhook_state.json`. Your PC, the bridge and
ngrok must stay running. A free ngrok address changes each time ngrok restarts, so update both alerts
when it does. `python test_webhook.py` checks the bridge offline.

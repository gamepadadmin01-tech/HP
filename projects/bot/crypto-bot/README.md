# crypto-bot

## Running the bot for real: `live_bot.py`

`live_bot.py` is the one to run day to day. It runs nonstop: every minute it reads prices,
checks each trade's stop-loss on the exchange and updates the dashboard; right after each daily
close (00:00 UTC = 05:30 IST) it applies the Breakout rules and places orders. Every buy gets a
stop-loss order **on Binance**, so the stop protects you even if your laptop is off.

It trades **10 coins** (BTC ETH SOL BNB XRP ADA DOGE LTC LINK AVAX) from one account, risking
**0.3% per trade** — the size at which `portfolio.py` showed 10 coins beating BTC+ETH alone. A new
trade only gets cash that open trades aren't already using. `--coins BTC ETH --risk 0.01` goes back
to the original two-coin setup.

**No terminal needed — double-click these, in order:**
1. `setup_keys.bat` — saves your testnet keys (and optional Telegram alerts) on this PC.
2. `start_bot.bat` — starts the bot on the testnet; it restarts itself if it ever stops.
3. Open http://localhost:8077 in your browser for the dashboard:
   - **Overview** — account value, today's result vs the loss limit, open trades, a countdown to the
     next daily close, and a card per coin (in a trade, or how close it is to buying).
   - **Charts** — daily candles per coin with the buy level, sell level, entry and stop-loss drawn
     on, the bot's buys/sells marked, and a plain-words explanation of what it is waiting for.
   - **Performance** — account value over time (recorded every 15 minutes), profit/loss, win rate,
     worst drop, results by coin and by how trades ended, and every trade.
   - **Activity** — everything the bot did and decided, in your local time, with filters and search.
   - **Pause / Resume / Sell everything** buttons (each asks to confirm). They work only from this
     laptop's own dashboard page: the page carries a secret code the bot creates at each start, so
     other websites open in your browser cannot press them.
4. Optional: `install_autostart.bat` makes the bot start by itself whenever you log in to Windows;
   `remove_autostart.bat` undoes that.

Your own limits can be passed to the launcher, e.g. `start_bot.bat --account 500 --max-position 150`.

**Speed**
- Stop-losses are orders sitting **on Binance**: Binance sells within milliseconds of the price
  touching the stop, even if this laptop is off. Nothing on a laptop can react faster.
- Buys and sells are market orders (filled at once); a request takes ~0.2–0.4 s from this laptop.
- The bot wakes 2 seconds after each daily close to place orders, checks every 15 s while a trade is
  open (to notice stop-outs) and every 60 s otherwise. The dashboard shows Binance's response time.

**Safety built in**
- Shared cash: all open trades together can never use more than `--account`.
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
   With 10 coins at 0.3%, use 500 USDT or more; below that some trades fall under Binance's
   5 USDT minimum order and are skipped.
4. Set the live variables yourself (never paste keys into chat):
   ```
   setx BINANCE_LIVE_API_KEY "..."
   setx BINANCE_LIVE_SECRET "..."
   setx LIVE_TRADING_CONFIRM "I_ACCEPT_REAL_MONEY_RISK"
   ```
5. Open a new terminal: `start_bot.bat --mode live --account 500 --max-position 100`.
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

### Training bot v2: take-or-skip filter (`trade_filter.py`)

A smaller job for the learner: the Breakout rule finds every trade and decides every exit; the bot
only decides **take or skip** each buy signal. Each past trade rewards the market situation it started
in with its result in R (trend, 4-week momentum, overbought, volatility, volume surge). A situation is
skipped only after clearly losing over many trades (it is anchored to the average Breakout result), and
it learns from 10 coins (BTC, ETH, SOL, BNB, XRP, ADA, DOGE, LTC, LINK, AVAX) for more examples.

```
python trade_filter.py      # walk-forward 2021-2026, 58 year x coin tests, a few seconds
```

Result (Oct 2026): **no value.** Same as the rules in 42 tests, better in 8, worse in 8; compounded
+860% vs +944% for the rules; average trade +0.83R vs +0.84R. Almost no situation reliably loses with
Breakout — losses are capped near −1R while a few big winners pay for everything, so skipping trades
mostly risks skipping a winner. A tempting pattern (volume-surge breakouts +1.97R in 2023–2025) failed
on the years it wasn't found in (2018–2022: +1.59R vs +2.43R for ordinary volume).

Conclusion from both training bots: on this data the edge comes from the rules plus the stop-loss and
position sizing, not from predicting which trades win. Detail: `results/trade_filter_walk_forward.csv`.

## Many coins in one account (`portfolio.py`)

Breakout rules on several coins sharing **one** account (each trade risks a slice of the current
balance, cash limits respected, delisted coins sold at their last price), 2021 to Oct 2026.
Checked identical to `backtest.py` when run on a single coin.

| at 1% risk per trade | BTC+ETH | 10 coins | 10 + 10 that crashed |
|---|---|---|---|
| Per year | +7.9% | +33.8% | +52.2% |
| Worst drop | −12.1% | −43.3% | −52.4% |
| Return / worst drop | 0.65 | 0.78 | 1.00 |
| Sharpe | 0.78 | 0.98 | 1.13 |

All four pre-set rules pass (better return/drop, better Sharpe, better in 4 of 6 years, still better
with crashed coins FTT, LUNC, EOS, FIL, ICP, SAND, XLM, ETC, MATIC, POL added). **But:**
- At 1% per trade the 10-coin drops are far bigger, because altcoins fall together. Matched to the
  same worst drop (0.2% per trade) it earns +10.0%/yr vs +7.9%, Sharpe 0.98 vs 0.78.
- Without 2021 (the altcoin mania), 10 coins at 1% is **no better** (return/drop 0.32 vs 0.33);
  at **0.3% per trade** it clearly is (0.58 vs 0.33, Sharpe 0.71 vs 0.47).

**So: trade 10 coins only with the risk per trade cut to about 0.25–0.3%.** At that size an account
needs roughly 500 USDT or more, or some positions fall under Binance's 5 USDT minimum order.
LUNC's own May-2022 collapse isn't in the data (Binance only has it from after).

## What else was tested on the 10-coin bot (Oct 2026) — all rejected, current setup kept

Each test had its pass rules written down before running (better return/worst-drop, better
Sharpe, better in at least 4 of 6 years, 2021 to now). None passed, which is good news: the live
setup (daily, 20/10/2, 10 coins, 0.3% risk) is not a lucky pick.

| Test | Script | Result |
|---|---|---|
| Tune entry/exit/stop (72 combinations), re-picked each year from the 3 years before | `tune.py` | Tuned 0.73 return/drop vs 1.10 for 20/10/2; better in 2 of 6 years. 20/10/2 ranks 3rd of 72 over the whole period, on a plateau of similar settings |
| Only buy while BTC is above its 200-day average | `safety_rules.py` | Softer 2022 (−1.9% vs −8.6%) but missed the 2023 recovery; worse drop, better in 3 of 6 years |
| At most 5 trades open at once | `safety_rules.py` | Worse on everything: it throws away the diversification |
| 4-hour candles instead of daily | `timeframe_test.py` | 6× more trades; −36% worst drop at the same risk; at matched drop +9.8%/yr vs +14.8% |
| 1-hour, 30-minute, 15-minute candles (intraday / scalping), at 0.1% and 0.075% fees | `intraday_test.py` | All lose heavily, every year: 1h −25%/yr, 30m −64%/yr, 15m wiped out by 2024. Daily +11%/yr over the same 2021–now window |

**Why fast timeframes fail — edge per trade vs cost per trade** (same rules, 2021–now, costs in R):

| Candles | Edge with zero costs | Typical stop distance | Fees + slippage per trade |
|---|---|---|---|
| Daily | +0.78R | 12.3% | 0.02R |
| 1-hour | +0.08R | 2.2% | 0.14R |
| 30-minute | +0.05R | 1.5% | 0.20R |
| 15-minute | −0.01R | 1.1% | 0.29R |

Shorter candles mean tighter stops, so each trade must be bigger to risk the same amount, and the
fees on that bigger trade eat a large share of what is risked. On 15-minute candles there is no
edge even before costs. A scalping strategy would need an edge well above ~0.3R per trade after
costs, which this rule family does not have.

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

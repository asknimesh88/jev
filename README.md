# Jev — private perps trading dashboard

Type a pair (e.g. `BTCUSDT`), press Enter. Jev pulls live candles, computes technicals, reads sentiment
(Fear & Greed, funding, long/short) and fundamentals (CoinGecko), then returns a **15m** and a **1h** plan:
**Entry / Stop Loss / TP1 / TP2** — or tells you the chance is gone.

| Verdict | Meaning |
|---|---|
| `ENTER NOW` | Setup valid and price is still in the value zone |
| `WAIT FOR PULLBACK` | Setup valid, but enter only on the limit price shown |
| `CHANCE GONE` | Move already extended / RSI stretched — don't chase |
| `NO TRADE` | No edge, choppy, against higher TF, or resistance/support too close |

Stack: Cloudflare Pages (static UI) + Pages Functions (API + password gate). No database, no build step.

## Deploy (≈5 min)
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
2. Build command: *(none)* · Build output directory: `public`
3. **Settings → Variables and Secrets** (Production), add:
   - `JEV_PASSWORD` — your login password (required)
   - `SESSION_SECRET` — any long random string (recommended)
   - `ANTHROPIC_API_KEY` — optional, turns on the AI-written briefing (levels/verdicts always come from the rules engine)
4. Redeploy. Open the URL → password prompt.

Local: `npm i && printf 'JEV_PASSWORD=test\n' > .dev.vars && npm run dev`

## How signals are made
Weighted confluence score in [-1, 1]: trend (EMA20/50/200 × ADX) 27%, higher-TF alignment 25%, momentum (RSI/MACD) 20%,
sentiment 12%, structure/breakout 10%, fundamentals 6%.
Entry = EMA20 pullback; stop = beyond nearest swing ± ATR (1–2.5 ATR); TP1/TP2 = 1.5R/2.5R, capped by the next S/R.
"Confidence" is confluence strength, **not** a calibrated win probability. Not financial advice.

Data: Binance (data-api.binance.vision → api.binance.com) with Bybit fallback; spot crypto pairs only for now.
`npm test` runs engine sanity tests.

## v2: Jev decision layer, perps, Telegram

**Jev** (TypeSafe System One) is called through the Composio API. For each timeframe the rules engine proposes a plan, then Jev
answers three questions: direction (long/short/neutral), *P(TP1 hits before stop)*, and *how much of the opportunity is left*.
Jev's probability becomes the displayed confidence, and it can veto: TP-first < 50% → NO TRADE, Jev strongly opposes → NO TRADE,
opportunity left < 30% → CHANCE GONE (tune in `functions/_lib/jev.js → GATES`). If Jev is unreachable, the app falls back to rules and says so.
Set the Pages secret **`JEV_API_KEY`** (direct `POST https://api.typesafe.ai/v1/systemone`, Bearer auth). Optional: `JEV_MODEL` (default `jev-latest`). Composio is only a fallback if `JEV_API_KEY` is absent (`COMPOSIO_API_KEY` + `JEV_CONNECTED_ACCOUNT_ID`). Never commit the key.

**Perps:** data comes from perpetual-futures markets (Bybit linear → Binance USD-M → OKX swap). The dashboard has a sizing calculator:
risk-based position size, margin, estimated liquidation, and a warning if liquidation would hit before your stop.

**Telegram** (create a bot with @BotFather, get your chat id from @userinfobot):
1. Pages secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` (random string).
2. Register the webhook once:
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://<your-site>/api/telegram -d secret_token=<WEBHOOK_SECRET>`
3. Message the bot `BTCUSDT` (or just `sol`) → it replies with the 15m + 1h plan. The dashboard also has a **Send to Telegram** button.
4. Push alerts: deploy the watcher — `cd worker`, create KV (`npx wrangler kv namespace create STATE`), paste the id in `worker/wrangler.toml`,
   set `WATCHLIST`, add the secrets listed there, `npx wrangler deploy`. Every 3 min it scans a rotating batch of 3 coins (whole list &#126; every 12 min) and alerts when a setup becomes ENTER NOW / WAIT, and when a pending one dies.

## Smart-money overlay (SMC toggle on the chart)
Drawn from closed candles by `functions/_lib/smc.js` using swing pivots (w=3): **BOS/CHoCH** (a close through the last swing; CHoCH = against the prior trend),
**order blocks** (last opposite-colour candle at the origin of the breaking leg; shown until price closes through them), **liquidity sweeps** (wick through a swing, close back),
and **EQH/EQL** pools (equal highs/lows not yet taken). They're added to the "Why" list and sent to Jev as context, but are *not* part of the rules score (no backtest yet).

## TradingView: `pine/jev_smc_confluence.pine`
Pine v6 port of the Jev rules engine for TradingView. Paste it into the Pine Editor, then **Add to chart**.
- **Signals**: BUY/SELL prints on a closed bar only when the 9-item checklist passes. Three items are required: the Jev score is at or above the threshold, price reacted at a live OB/FVG, and there is room to the next S/R. In total ≥ 8/9 items must pass by default, and Jev's choppy veto applies. The label shows Jev's Entry/SL/TP1/TP2.
- **Factors**: the same weights as `signal.js` (trend 27, HTF 25, momentum 20, structure 10, fundamentals 6). Funding, long/short and Fear & Greed aren't available in Pine, so that 12% goes to SMC structure bias instead.
- **Fundamentals**: stocks use TradingView financials (EPS and revenue growth, ROE, D/E, FCF). Crypto uses TOTAL market-cap trend, USDT.D (risk-off) and, for alts, BTC.D. Everything else uses 30-day performance only.
- **Drawn**: BOS/CHoCH, the latest N bull/bear order blocks, and the N *strongest* FVGs (gap × displacement × volume). A zone is deleted as soon as it is invalidated (closed through).
- **Alerts**: "Jev BUY"/"Jev SELL" conditions. Use *Any alert() function call* to get a JSON payload (entry/sl/tp/score) for webhooks.

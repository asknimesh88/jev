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
   set `WATCHLIST`, add the secrets listed there, `npx wrangler deploy`. Every 5 min it alerts when a setup becomes ENTER NOW / WAIT, and when a pending one dies.

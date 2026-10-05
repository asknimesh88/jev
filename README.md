# Jev — private trading dashboard

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

# Jev SMC Toolkit (TradingView, Pine v6)

1. TradingView → **Pine Editor** → New indicator → paste `jev_smc_toolkit.pine` → **Add to chart**.
2. Every feature has its own switch in the indicator's **Settings → Inputs** (EMA ribbon per-EMA, BOS, CHoCH, sweeps, order blocks, FVGs, ★ best FVG, VWAP, A+ setups).
3. Alerts: right-click chart → Add alert → condition **Jev SMC** → pick BOS/CHoCH, sweep or A+ setup.

Notes
- Structure logic only evaluates on closed bars (no repainting after close). Swing points confirm `Swing length` bars late, as with any pivot-based tool.
- ★ **Best FVG** = highest *score* (proximity, structure bias, displacement, size, untouched, premium/discount, OB confluence) among unfilled gaps on the correct side of price. It's a ranking heuristic, not a calibrated probability.
- **A+ setup** = price taps an active OB/FVG in the direction of structure + bullish/bearish rejection candle, scored with a recent liquidity sweep, EMA trend and VWAP side. Default minimum score 75.
- On daily+ timeframes VWAP resets every bar (use the Day anchor on intraday charts).

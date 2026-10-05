import { getKlines, getDerivatives, getFearGreed, getFundamentals } from "./data.js";
import { analyzeTimeframe, snapshot, round } from "./signal.js";
import { applyJev } from "./jev.js";
import { aiNarrative } from "./ai.js";

export const cleanSymbol = (raw) => String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const validSymbol = (s) => /^[A-Z0-9]{5,20}$/.test(s);

export async function runAnalysis(env, symbol, { narrative = true, lite = false } = {}) {
  const [k15, k1h, k4h, k1d, derivatives, fearGreed, fundamentals] = await Promise.all([
    getKlines(symbol, "15m"), getKlines(symbol, "1h"), getKlines(symbol, "4h"), getKlines(symbol, "1d"),
    getDerivatives(symbol), getFearGreed(), lite ? null : getFundamentals(symbol),
  ]);
  const ctx = { derivatives, fearGreed, fundamentals };
  const s15 = analyzeTimeframe({ tf: "15m", candles: k15.candles, htf: [{ tf: "1h", candles: k1h.candles }, { tf: "4h", candles: k4h.candles }], ...ctx });
  const s1h = analyzeTimeframe({ tf: "1h", candles: k1h.candles, htf: [{ tf: "4h", candles: k4h.candles }, { tf: "1d", candles: k1d.candles }], ...ctx });
  const signals = [s15, s1h];
  await Promise.all(signals.map((s) => applyJev(env, symbol, s, ctx)));
  const nar = narrative ? await aiNarrative(env, symbol, signals, ctx) : null;

  const mtf = [["15m", k15], ["1h", k1h], ["4h", k4h], ["1d", k1d]].map(([tf, k]) => {
    const x = snapshot(k.candles);
    return { tf, trend: +x.stack.toFixed(2), rsi: +x.rsi.toFixed(1), adx: +(x.adx ?? 0).toFixed(1), atrPct: +((x.atr / x.price) * 100).toFixed(2),
      aboveEma200: x.ema200 != null ? x.price > x.ema200 : null, ema20: round(x.ema20), ema50: round(x.ema50), ema200: round(x.ema200) };
  });
  const day = k1h.candles.slice(-24);
  const stats24 = { high: round(Math.max(...day.map((c) => c.h))), low: round(Math.min(...day.map((c) => c.l))), volume: Math.round(day.reduce((a, c) => a + c.v * c.c, 0)) };

  const p24 = k1h.candles.length >= 25 ? k1h.candles[k1h.candles.length - 25].c : null;
  return {
    symbol, market: "perp", source: k1h.source, price: s1h.price,
    change24h: p24 ? +(((s1h.price - p24) / p24) * 100).toFixed(2) : null,
    generatedAt: new Date().toISOString(),
    jevActive: signals.some((s) => s.jev?.used),
    signals, mtf, stats24, narrative: nar, derivatives, fearGreed, fundamentals,
  };
}

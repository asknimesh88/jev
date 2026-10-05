import { getKlines, getDerivatives, getFearGreed, getFundamentals } from "../_lib/data.js";
import { analyzeTimeframe } from "../_lib/signal.js";
import { aiNarrative } from "../_lib/ai.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestGet({ request, env }) {
  const raw = new URL(request.url).searchParams.get("symbol") || "";
  const symbol = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return json({ error: "Enter a pair like BTCUSDT" }, 400);

  try {
    const [k15, k1h, k4h, k1d, derivatives, fearGreed, fundamentals] = await Promise.all([
      getKlines(symbol, "15m"), getKlines(symbol, "1h"), getKlines(symbol, "4h"), getKlines(symbol, "1d"),
      getDerivatives(symbol), getFearGreed(), getFundamentals(symbol),
    ]);
    const ctx = { derivatives, fearGreed, fundamentals };
    const s15 = analyzeTimeframe({ tf: "15m", candles: k15.candles, htf: [{ tf: "1h", candles: k1h.candles }, { tf: "4h", candles: k4h.candles }], ...ctx });
    const s1h = analyzeTimeframe({ tf: "1h", candles: k1h.candles, htf: [{ tf: "4h", candles: k4h.candles }, { tf: "1d", candles: k1d.candles }], ...ctx });
    const signals = [s15, s1h];
    const narrative = await aiNarrative(env, symbol, signals, ctx);

    const p24 = k1h.candles.length >= 25 ? k1h.candles[k1h.candles.length - 25].c : null;
    return json({
      symbol, source: k1h.source, price: s1h.price, change24h: p24 ? +(((s1h.price - p24) / p24) * 100).toFixed(2) : null,
      generatedAt: new Date().toISOString(),
      signals, narrative, derivatives, fearGreed, fundamentals,
    });
  } catch (e) {
    return json({ error: e.message || "analysis failed" }, 502);
  }
}

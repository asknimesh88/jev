// Smoke test: feeds synthetic candles through the engine and checks invariants.
import { analyzeTimeframe } from "../functions/_lib/signal.js";

function gen(n, drift, step, start = 100, vol = 1) {
  let p = start, t = 1700000000; const out = [];
  for (let i = 0; i < n; i++) {
    const o = p, c = p * (1 + drift + Math.sin(i / 3) * 0.003 + Math.cos(i * 1.7) * 0.002);
    out.push({ t, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 100 * vol + (i % 7) * 10 });
    p = c; t += step;
  }
  return out;
}
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error("FAIL", m); } else console.log("ok  ", m); };
for (const [name, drift] of [["uptrend", 0.002], ["downtrend", -0.002], ["flat", 0]]) {
  const c15 = gen(300, drift, 900), c1h = gen(300, drift, 3600), c4h = gen(300, drift, 14400), c1d = gen(300, drift, 86400);
  const s = analyzeTimeframe({ tf: "15m", candles: c15, htf: [{ tf: "1h", candles: c1h }, { tf: "4h", candles: c4h }], derivatives: { funding: 0.0001 }, fearGreed: { value: 50, label: "Neutral" }, fundamentals: null });
  const p = s.plan, long = s.direction === "LONG";
  console.log(name, s.verdict, s.direction, s.confidence, p);
  ok(isFinite(p.entry) && isFinite(p.stopLoss) && isFinite(p.tp1) && isFinite(p.tp2), `${name}: finite levels`);
  ok(long ? p.stopLoss < p.entry && p.tp1 > p.entry && p.tp2 >= p.tp1 : p.stopLoss > p.entry && p.tp1 < p.entry && p.tp2 <= p.tp1, `${name}: level ordering matches direction`);
  ok(s.confidence >= 50 && s.confidence <= 88, `${name}: confidence in range`);
  ok(s.chart.candles.length === 160 && s.chart.ema20.length === 160, `${name}: chart series`);
}
process.exit(fail ? 1 : 0);

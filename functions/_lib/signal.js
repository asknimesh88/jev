// Jev signal engine: multi-factor confluence → direction, confidence, and a trade plan (entry / TP / SL),
// plus an explicit verdict: ENTER NOW, WAIT FOR PULLBACK, MISSED, or NO TRADE.
import { ema, rsi, atr, macd, bollinger, adx, pivots, sma, last } from "./indicators.js";

const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

export function round(x) {
  if (x == null || !isFinite(x)) return x;
  const d = x >= 1000 ? 2 : x >= 10 ? 3 : x >= 1 ? 4 : x >= 0.01 ? 6 : 8;
  return +x.toFixed(d);
}

// Indicator snapshot on CLOSED candles (live candle only supplies the price).
export function snapshot(candles) {
  const closed = candles.slice(0, -1);
  const h = closed.map((c) => c.h), l = closed.map((c) => c.l), c = closed.map((x) => x.c), v = closed.map((x) => x.v);
  const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
  const r = rsi(c), a = atr(h, l, c), m = macd(c), bb = bollinger(c), ad = adx(h, l, c), vs = sma(v, 20);
  const i = c.length - 1;
  const price = last(candles).c;
  const s = {
    price, i, closed, h, l, c,
    ema20: e20[i], ema50: e50[i], ema200: e200[i],
    rsi: r[i], atr: a[i], macdHist: m.hist[i], macdHistPrev: m.hist[i - 1], macdLine: m.line[i],
    bbUp: bb.up[i], bbLo: bb.lo[i], bbMid: bb.mid[i],
    adx: ad.adx[i], pdi: ad.pdi[i], mdi: ad.mdi[i],
    volRatio: vs[i] ? v[i] / vs[i] : 1,
    series: { e20, e50, e200 },
  };
  const ref200 = s.ema200 ?? s.ema50;
  s.stack = clamp(((price > s.ema20) + (s.ema20 > s.ema50) + (s.ema50 > ref200) - 1.5) / 1.5);
  return s;
}

const trendOf = (s) => clamp(s.stack * (0.55 + 0.45 * Math.min((s.adx ?? 15) / 30, 1)));

export function analyzeTimeframe({ tf, candles, htf, derivatives, fearGreed, fundamentals }) {
  const s = snapshot(candles);
  const { price, atr: A } = s;
  const reasons = [];
  const pts = (txt, bull) => reasons.push({ text: txt, bias: bull > 0 ? "bull" : bull < 0 ? "bear" : "neutral" });

  // ---- 1. Trend (EMA stack weighted by ADX)
  const trend = trendOf(s);
  pts(`EMA20/50/200 stack ${trend > 0.3 ? "bullish" : trend < -0.3 ? "bearish" : "mixed"}, ADX ${s.adx?.toFixed(0)} (${s.adx > 25 ? "trending" : s.adx < 18 ? "choppy" : "building"})`, trend);

  // ---- 2. Momentum (RSI + MACD histogram)
  const rsiC = clamp((s.rsi - 50) / 25);
  const macdC = clamp((s.macdHist / A) * 4);
  const momentum = 0.5 * rsiC + 0.5 * macdC;
  pts(`RSI ${s.rsi.toFixed(0)}, MACD histogram ${s.macdHist > 0 ? "positive" : "negative"} and ${Math.abs(s.macdHist) > Math.abs(s.macdHistPrev) ? "expanding" : "fading"}`, momentum);

  // ---- 3. Higher-timeframe alignment
  const htfScores = htf.map((h) => ({ tf: h.tf, score: trendOf(snapshot(h.candles)) }));
  const htfBias = htfScores.reduce((a, b) => a + b.score, 0) / (htfScores.length || 1);
  pts(`Higher timeframes (${htfScores.map((h) => `${h.tf} ${h.score > 0.25 ? "↑" : h.score < -0.25 ? "↓" : "→"}`).join(", ")}) ${htfBias > 0.25 ? "support longs" : htfBias < -0.25 ? "support shorts" : "are neutral"}`, htfBias);

  // ---- 4. Structure / breakout with volume
  const hi20 = Math.max(...s.h.slice(-21, -1)), lo20 = Math.min(...s.l.slice(-21, -1));
  let structure = 0;
  if (price > hi20) structure = clamp(0.5 + (s.volRatio - 1) * 0.5, 0.3, 1);
  else if (price < lo20) structure = -clamp(0.5 + (s.volRatio - 1) * 0.5, 0.3, 1);
  else structure = clamp(((price - s.bbMid) / (s.bbUp - s.bbMid || 1)) * 0.4);
  pts(structure > 0.4 ? "Breaking 20-bar high" + (s.volRatio > 1.3 ? " on strong volume" : "") : structure < -0.4 ? "Breaking 20-bar low" + (s.volRatio > 1.3 ? " on strong volume" : "") : "Trading inside its recent range", structure);

  // ---- 5. Sentiment (contrarian at extremes: crowded positioning, fear/greed)
  let sent = 0, sentParts = 0;
  if (derivatives?.funding != null) {
    const f = derivatives.funding * 100; // %
    const fs = clamp(-f / 0.06);
    sent += fs; sentParts++;
    pts(`Funding ${f.toFixed(4)}% — ${f > 0.04 ? "longs crowded (contrarian bearish)" : f < -0.02 ? "shorts crowded (contrarian bullish)" : "neutral positioning"}`, fs * (Math.abs(f) > 0.02 ? 1 : 0));
  }
  if (derivatives?.longShort != null) {
    const ls = clamp((1 - derivatives.longShort) * 1.2);
    sent += ls * 0.6; sentParts++;
  }
  if (fearGreed) {
    const fg = fearGreed.value;
    const g = fg <= 20 ? 0.6 : fg <= 35 ? 0.25 : fg >= 80 ? -0.6 : fg >= 65 ? -0.25 : 0;
    sent += g; sentParts++;
    pts(`Fear & Greed ${fg} (${fearGreed.label})`, g);
  }
  const sentiment = sentParts ? clamp(sent / sentParts) : 0;

  // ---- 6. Fundamentals (light weight; only ever a tiebreaker)
  let fund = 0;
  if (fundamentals) {
    const r = fundamentals.rank;
    if (r && r <= 20) fund += 0.2; else if (r && r > 100) fund -= 0.2;
    if (fundamentals.change30d != null) fund += clamp(fundamentals.change30d / 40, -0.4, 0.4);
    if (fundamentals.volumeToMcap != null && fundamentals.volumeToMcap < 0.01) fund -= 0.2;
    fund = clamp(fund);
    pts(`Fundamentals: ${fundamentals.name} rank #${r ?? "?"}, 30d ${fundamentals.change30d?.toFixed(1)}%`, fund);
  }

  const W = { trend: 0.27, momentum: 0.2, htf: 0.25, structure: 0.1, sentiment: 0.12, fund: 0.06 };
  const score = trend * W.trend + momentum * W.momentum + htfBias * W.htf + structure * W.structure + sentiment * W.sentiment + fund * W.fund;
  const dir = score >= 0 ? "LONG" : "SHORT";
  const sign = dir === "LONG" ? 1 : -1;
  let confidence = Math.round(50 + 38 * Math.min(Math.abs(score) / 0.6, 1));

  // ---- Levels
  const { highs, lows } = pivots(s.h, s.l, 3);
  const above = highs.map((p) => p.p).filter((p) => p > price).sort((a, b) => a - b);
  const below = lows.map((p) => p.p).filter((p) => p < price).sort((a, b) => b - a);
  const support = below[0] ?? null, resistance = above[0] ?? null;

  // Ideal entry: pullback to EMA20 in trend direction; if price is already there, enter at market.
  const pullback = s.ema20;
  const ext = ((price - pullback) / A) * sign; // ATRs the move is extended beyond the pullback level
  let entry, status, entryNote;
  if (ext <= 0.35) { entry = price; status = "ENTER_NOW"; entryNote = "Price is at/near the value zone — entry is live."; }
  else if (ext <= 1.0) { entry = pullback; status = "WAIT"; entryNote = `Price is ${ext.toFixed(1)} ATR extended. Place a limit at the EMA20 pullback; skip if it never fills.`; }
  else { entry = price; status = "MISSED"; entryNote = `Price is ${ext.toFixed(1)} ATR beyond value — the clean entry has passed.`; }

  // Stop: beyond the nearest swing (with ATR buffer), kept between 1.0–2.5 ATR from entry.
  const swing = dir === "LONG" ? below.find((p) => p < entry) : above.find((p) => p > entry);
  let risk = swing != null ? Math.abs(entry - swing) + 0.25 * A : 1.5 * A;
  risk = Math.min(Math.max(risk, 1.0 * A), 2.5 * A);
  const sl = entry - sign * risk;
  let tp1 = entry + sign * risk * 1.5;
  let tp2 = entry + sign * risk * 2.5;
  const obstacle = dir === "LONG" ? resistance : support;
  const obstacleR = obstacle != null ? (Math.abs(obstacle - entry) / risk) : Infinity;
  if (obstacleR < 2.5 && obstacleR >= 1.2) {
    tp2 = entry + sign * Math.abs(obstacle - entry) * 0.98;
    if (obstacleR < 1.5) tp1 = entry + sign * Math.abs(obstacle - entry) * 0.9;
  }

  // ---- Veto rules → NO_TRADE (takes priority over MISSED/WAIT)
  const veto = [];
  if (Math.abs(score) < 0.2) veto.push("No clear edge — signals are mixed.");
  if (s.adx < 15 && Math.abs(trend) < 0.5) veto.push("Market is choppy (ADX < 15).");
  if (Math.sign(htfBias) !== sign && Math.abs(htfBias) > 0.45 && Math.abs(score) < 0.5) veto.push(`Fighting the higher-timeframe trend (${htfBias > 0 ? "up" : "down"}).`);
  if (obstacleR < 1.2) veto.push(`${dir === "LONG" ? "Resistance" : "Support"} at ${round(obstacle)} is too close — poor reward:risk.`);
  if (status !== "MISSED" && ((dir === "LONG" && s.rsi > 75) || (dir === "SHORT" && s.rsi < 25))) {
    status = "MISSED"; entryNote = `RSI ${s.rsi.toFixed(0)} is stretched — chasing here has poor odds.`;
  }
  let verdict = status;
  if (veto.length) verdict = "NO_TRADE";
  if (verdict === "MISSED") confidence = Math.min(confidence, 55);
  if (verdict === "NO_TRADE") confidence = Math.min(confidence, 50);

  const rr1 = Math.abs(tp1 - entry) / risk, rr2 = Math.abs(tp2 - entry) / risk;
  const wait = verdict === "WAIT";
  return {
    tf, verdict, direction: dir, confidence, score: +score.toFixed(3),
    price: round(price),
    plan: {
      entry: round(entry), entryType: wait ? "LIMIT" : "MARKET",
      stopLoss: round(sl), tp1: round(tp1), tp2: round(tp2),
      riskPct: +((risk / entry) * 100).toFixed(2), rr1: +rr1.toFixed(2), rr2: +rr2.toFixed(2),
      invalidation: wait
        ? `Cancel if price hits ${round(tp1)} before filling, or closes ${dir === "LONG" ? "below" : "above"} ${round(sl)}.`
        : `Exit if a candle closes ${dir === "LONG" ? "below" : "above"} ${round(sl)}.`,
    },
    note: veto.length ? veto.join(" ") : entryNote,
    components: { trend, momentum, htf: htfBias, structure, sentiment, fundamentals: fund },
    indicators: {
      ema20: round(s.ema20), ema50: round(s.ema50), ema200: round(s.ema200), rsi: +s.rsi.toFixed(1),
      macdHist: round(s.macdHist), atr: round(A), atrPct: +((A / price) * 100).toFixed(2), adx: +(s.adx ?? 0).toFixed(1),
      volRatio: +s.volRatio.toFixed(2), support: round(support), resistance: round(resistance),
    },
    reasons,
    chart: chartSeries(candles, s),
  };
}

function chartSeries(candles, s) {
  const n = 160;
  const slice = candles.slice(-n);
  const pick = (arr) => slice.map((_, k) => { const idx = candles.length - n + k; const v = arr[idx]; return v == null ? null : round(v); });
  return { candles: slice, ema20: pick(s.series.e20), ema50: pick(s.series.e50) };
}

// Smart-money concepts on CLOSED candles: structure breaks (BOS/CHoCH), order blocks, liquidity sweeps, equal highs/lows.
// ponytail: naive swing-pivot heuristics (w=3), no displacement/FVG filtering. Add if OBs turn out too noisy.
import { pivots } from "./indicators.js";

const W = 3;

export function smc(candles, atr, show = 160) {
  const c = candles.slice(0, -1);
  const n = c.length, off = candles.length - show, tol = 0.2 * atr;
  const { highs, lows } = pivots(c.map((x) => x.h), c.map((x) => x.l), W);
  const ev = [...highs.map((p) => ({ ...p, t: "H" })), ...lows.map((p) => ({ ...p, t: "L" }))].sort((a, b) => a.i - b.i);
  let sh = null, sl = null, trend = 0, e = 0;
  const breaks = [], obs = [], sweeps = [];

  for (let i = 0; i < n; i++) {
    while (e < ev.length && ev[e].i + W <= i) { const p = { ...ev[e++], used: false }; p.t === "H" ? (sh = p) : (sl = p); }
    const x = c[i];
    for (const bull of [true, false]) {
      const sw = bull ? sh : sl;
      if (!sw || sw.used) continue;
      const closedThrough = bull ? x.c > sw.p : x.c < sw.p;
      const wickedThrough = bull ? x.h > sw.p : x.l < sw.p;
      if (closedThrough) {
        sw.used = true;
        breaks.push({ i, from: sw.i, level: sw.p, dir: bull ? "bull" : "bear", type: trend === (bull ? -1 : 1) ? "CHoCH" : "BOS" });
        trend = bull ? 1 : -1;
        // order block = the last opposite-colour candle at the origin of the leg (lowest low / highest high)
        const origin = bull ? sl : sh, from = origin && origin.i < i ? origin.i : sw.i;
        let k = -1;
        for (let j = from; j < i; j++) {
          if (bull ? c[j].c < c[j].o : c[j].c > c[j].o) if (k < 0 || (bull ? c[j].l < c[k].l : c[j].h > c[k].h)) k = j;
        }
        if (k >= 0) obs.push({ i: k, hi: c[k].h, lo: c[k].l, dir: bull ? "bull" : "bear", brk: i, mit: null });
      } else if (wickedThrough) {
        sw.used = true;
        sweeps.push({ i, from: sw.i, level: sw.p, side: bull ? "bsl" : "ssl" }); // wick took the liquidity, close rejected it
      }
    }
    for (const o of obs) if (o.mit == null && i > o.brk && (o.dir === "bull" ? x.c < o.lo : x.c > o.hi)) o.mit = i;
  }

  // equal highs / lows = resting liquidity pools that haven't been taken yet
  const pools = [];
  for (const [list, side] of [[highs, "EQH"], [lows, "EQL"]]) {
    for (let a = 0; a < list.length - 1; a++) {
      const p = list[a], q = list[a + 1];
      if (Math.abs(p.p - q.p) > tol || q.i - p.i > 80) continue;
      const lvl = side === "EQH" ? Math.max(p.p, q.p) : Math.min(p.p, q.p);
      let taken = false;
      for (let j = q.i + 1; j < n; j++) if (side === "EQH" ? c[j].h > lvl + tol : c[j].l < lvl - tol) { taken = true; break; }
      if (!taken) pools.push({ from: p.i, to: q.i, level: lvl, side });
    }
  }

  const win = (x) => x.i >= off;
  const rel = (v) => Math.max(0, v - off);
  const recent = (arr, k) => arr.slice(-k);
  const live = obs.filter((o) => o.mit == null);
  const out = {
    breaks: recent(breaks.filter((b) => b.i >= off), 4).map((b) => ({ ...b, i: b.i - off, from: rel(b.from) })),
    obs: [...recent(live.filter((o) => o.dir === "bull"), 2), ...recent(live.filter((o) => o.dir === "bear"), 2)].filter((o) => o.brk >= off - 40)
      .map((o) => ({ ...o, i: rel(o.i), brk: rel(o.brk) })),
    sweeps: recent(sweeps.filter(win), 4).map((s) => ({ ...s, i: s.i - off, from: rel(s.from) })),
    pools: [...recent(pools.filter((p) => p.to >= off - 40 && p.side === "EQH"), 2), ...recent(pools.filter((p) => p.to >= off - 40 && p.side === "EQL"), 2)]
      .map((p) => ({ ...p, from: rel(p.from), to: rel(p.to) })),
    bias: trend === 1 ? "bull" : trend === -1 ? "bear" : "neutral",
  };
  out.lastBreak = out.breaks[out.breaks.length - 1] || null;
  out.lastSweep = out.sweeps[out.sweeps.length - 1] || null;
  out.recentSweepBars = out.lastSweep ? show - 1 - out.lastSweep.i : null;
  return out;
}

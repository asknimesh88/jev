import { smc } from "../functions/_lib/smc.js";
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.error("FAIL", m); } else console.log("ok  ", m); };
// zig-zag path: waypoints → candles (up legs bullish, down legs bearish), 6 bars per leg
const wp = [100, 90, 104, 96, 110, 100, 98, 112, 95, 94, 108, 85];
const cs = []; let t = 0;
for (let k = 0; k < wp.length - 1; k++) for (let j = 0; j < 6; j++) {
  const a = wp[k] + ((wp[k + 1] - wp[k]) * j) / 6, b = wp[k] + ((wp[k + 1] - wp[k]) * (j + 1)) / 6;
  cs.push({ t: t += 900, o: a, c: b, h: Math.max(a, b) + 0.3, l: Math.min(a, b) - 0.3, v: 1 });
}
// inject a sweep: wick above the prior swing high (110) that closes back under it
const r0 = smc(cs.concat([{ t: 0, o: 85, c: 85, h: 86, l: 84, v: 1 }]), 2, 60);
ok(r0.breaks.length > 0, "detects structure breaks");
ok(r0.breaks.some((b) => b.type === "CHoCH") || r0.breaks.some((b) => b.type === "BOS"), "labels BOS/CHoCH");
ok(r0.obs.every((o) => o.hi > o.lo && o.i <= o.brk), "order blocks well-formed, origin before break");
ok(r0.breaks.every((b) => b.from <= b.i && b.i >= 0), "break indices ordered and in window");
const sw = cs.slice(); sw.push({ t: 1, o: 100, c: 107, h: 111.5, l: 99, v: 1 }); // pokes above 110/112 swing, closes below
const r1 = smc(sw.concat([{ t: 2, o: 107, c: 107, h: 108, l: 106, v: 1 }]), 2, 60);
ok(r1.sweeps.some((s) => s.side === "bsl"), "detects a buy-side liquidity sweep (wick through, close back)");
process.exit(fail ? 1 : 0);

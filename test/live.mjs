import { onRequestGet } from "../functions/api/analyze.js";
const r = await onRequestGet({ request: new Request("http://x/api/analyze?symbol=BTCUSDT"), env: {} });
const d = await r.json();
console.log(r.status, d.error || JSON.stringify({ src: d.source, px: d.price, s: d.signals?.map(s => [s.tf, s.verdict, s.direction, s.confidence, s.plan]), fg: d.fearGreed, dv: d.derivatives, f: !!d.fundamentals }, null, 1));

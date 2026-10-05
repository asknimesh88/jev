// Cron watcher (separate Cloudflare Worker, Pages can't run cron). Every 3 min it analyzes a rotating batch of the WATCHLIST and
// pings Telegram when a setup becomes actionable (ENTER_NOW / WAIT) or a pending one dies (MISSED / NO_TRADE).
import { runAnalysis } from "../functions/_lib/analyze.js";
import { sendTelegram, formatSignal } from "../functions/_lib/telegram.js";

const ACTIVE = new Set(["ENTER_NOW", "WAIT"]);

export default {
  async scheduled(_evt, env, ctx) { ctx.waitUntil(scan(env)); },
  async fetch(_req, env) { await scan(env); return new Response("scanned"); }, // manual trigger: open the worker URL
};

// Workers have a per-invocation subrequest cap (50 on the free plan), so each run scans a rotating batch.
async function scan(env) {
  const all = (env.WATCHLIST || "BTCUSDT,ETHUSDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const batch = Number(env.BATCH || 3);
  const start = Number((await env.STATE.get("cursor")) || 0) % all.length;
  const list = Array.from({ length: Math.min(batch, all.length) }, (_, i) => all[(start + i) % all.length]);
  await env.STATE.put("cursor", String((start + list.length) % all.length));
  for (const symbol of list) {
    try {
      const a = await runAnalysis(env, symbol, { narrative: false, lite: true });
      for (const s of a.signals) {
        const key = `${symbol}:${s.tf}`;
        const prev = JSON.parse((await env.STATE.get(key)) || "null");
        const now = { verdict: s.verdict, direction: s.direction };
        const becameActive = ACTIVE.has(s.verdict) && (!prev || prev.verdict !== s.verdict || prev.direction !== s.direction);
        const died = prev && ACTIVE.has(prev.verdict) && !ACTIVE.has(s.verdict);
        if (becameActive) await sendTelegram(env, formatSignal(symbol, s));
        else if (died) await sendTelegram(env, `❌ <b>${symbol} ${s.tf}</b>: previous ${prev.direction} setup is off. ${s.verdict === "MISSED" ? "Chance gone — cancel any resting limit." : "No longer a valid trade."}`);
        if (!prev || prev.verdict !== now.verdict || prev.direction !== now.direction) await env.STATE.put(key, JSON.stringify(now), { expirationTtl: 86400 });
      }
    } catch (e) { console.log(symbol, e.message); }
  }
}

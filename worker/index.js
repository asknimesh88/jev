// Cron watcher (separate Cloudflare Worker, Pages can't run cron). Every 5 min it analyzes the WATCHLIST and
// pings Telegram when a setup becomes actionable (ENTER_NOW / WAIT) or a pending one dies (MISSED / NO_TRADE).
import { runAnalysis } from "../functions/_lib/analyze.js";
import { sendTelegram, formatSignal } from "../functions/_lib/telegram.js";

const ACTIVE = new Set(["ENTER_NOW", "WAIT"]);

export default {
  async scheduled(_evt, env, ctx) { ctx.waitUntil(scan(env)); },
  async fetch(_req, env) { await scan(env); return new Response("scanned"); }, // manual trigger: open the worker URL
};

async function scan(env) {
  const list = (env.WATCHLIST || "BTCUSDT,ETHUSDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const symbol of list) {
    try {
      const a = await runAnalysis(env, symbol, { narrative: false });
      for (const s of a.signals) {
        const key = `${symbol}:${s.tf}`;
        const prev = JSON.parse((await env.STATE.get(key)) || "null");
        const now = { verdict: s.verdict, direction: s.direction };
        const becameActive = ACTIVE.has(s.verdict) && (!prev || prev.verdict !== s.verdict || prev.direction !== s.direction);
        const died = prev && ACTIVE.has(prev.verdict) && !ACTIVE.has(s.verdict);
        if (becameActive) await sendTelegram(env, formatSignal(symbol, s));
        else if (died) await sendTelegram(env, `❌ <b>${symbol} ${s.tf}</b>: previous ${prev.direction} setup is off. ${s.verdict === "MISSED" ? "Chance gone — cancel any resting limit." : "No longer a valid trade."}`);
        await env.STATE.put(key, JSON.stringify(now), { expirationTtl: 86400 });
      }
    } catch (e) { console.log(symbol, e.message); }
  }
}

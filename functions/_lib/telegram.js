// Telegram helpers. Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (only this chat may talk to the bot), TELEGRAM_WEBHOOK_SECRET.
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export async function sendTelegram(env, text, chatId = env.TELEGRAM_CHAT_ID) {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) throw new Error("Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status}`);
}

const LABEL = { ENTER_NOW: "🟢 ENTER NOW", WAIT: "🟡 WAIT FOR PULLBACK", MISSED: "⚪ CHANCE GONE — don't chase", NO_TRADE: "⚪ NO TRADE" };

export function formatSignal(symbol, s) {
  const p = s.plan, live = s.verdict === "ENTER_NOW" || s.verdict === "WAIT";
  const head = `<b>${esc(symbol)} PERP · ${s.tf}</b>\n${LABEL[s.verdict]}${live ? ` — <b>${s.direction}</b>` : ""}`;
  const prob = s.jev?.used ? `\nJev: TP1-before-SL ${Math.round(s.jev.tpFirst * 100)}%` : `\nConfluence ${s.confidence}%`;
  if (!live) return `${head}\n${esc(s.note)}`;
  return `${head}${prob}\n` +
    `Entry: <code>${p.entry}</code> (${p.entryType.toLowerCase()})\n` +
    `SL: <code>${p.stopLoss}</code> (-${p.riskPct}%)\n` +
    `TP1: <code>${p.tp1}</code> (${p.rr1}R)\nTP2: <code>${p.tp2}</code> (${p.rr2}R)\n` +
    `<i>${esc(p.invalidation)}</i>`;
}

export const formatAnalysis = (a) =>
  `<b>${esc(a.symbol)}</b> ${a.price}\n\n` + a.signals.map((s) => formatSignal(a.symbol, s)).join("\n\n");

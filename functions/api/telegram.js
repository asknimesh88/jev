// Telegram webhook: message the bot a pair (e.g. "BTCUSDT" or "/sig eth") and it replies with the 15m + 1h plan.
// Not behind the password gate (Telegram calls it); protected by the webhook secret token + allowed chat id.
import { runAnalysis, cleanSymbol, validSymbol } from "../_lib/analyze.js";
import { sendTelegram, formatAnalysis } from "../_lib/telegram.js";

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const u = await request.json().catch(() => ({}));
  const msg = u.message;
  if (!msg?.text || String(msg.chat.id) !== String(env.TELEGRAM_CHAT_ID)) return new Response("ok");

  let sym = cleanSymbol(msg.text.replace(/^\/(sig|signal|analyze|start)(@\w+)?/i, ""));
  if (!sym) return (await sendTelegram(env, "Send a perp pair, e.g. <code>BTCUSDT</code> or <code>SOL</code>.", msg.chat.id), new Response("ok"));
  if (!/(USDT|USDC)$/.test(sym)) sym += "USDT";
  if (!validSymbol(sym)) return (await sendTelegram(env, "That doesn't look like a pair.", msg.chat.id), new Response("ok"));

  try {
    await sendTelegram(env, `Analyzing ${sym}…`, msg.chat.id);
    await sendTelegram(env, formatAnalysis(await runAnalysis(env, sym, { narrative: false })), msg.chat.id);
  } catch (e) {
    await sendTelegram(env, `Failed: ${e.message}`, msg.chat.id).catch(() => {});
  }
  return new Response("ok");
}

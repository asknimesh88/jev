// Dashboard "Send to Telegram" button (behind the password gate).
import { runAnalysis, cleanSymbol, validSymbol } from "../_lib/analyze.js";
import { sendTelegram, formatAnalysis } from "../_lib/telegram.js";

export async function onRequestPost({ request, env }) {
  const { symbol } = await request.json().catch(() => ({}));
  const sym = cleanSymbol(symbol);
  if (!validSymbol(sym)) return Response.json({ error: "bad symbol" }, { status: 400 });
  try {
    await sendTelegram(env, formatAnalysis(await runAnalysis(env, sym, { narrative: false })));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}

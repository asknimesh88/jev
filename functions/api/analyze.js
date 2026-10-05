import { runAnalysis, cleanSymbol, validSymbol } from "../_lib/analyze.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestGet({ request, env }) {
  const symbol = cleanSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!validSymbol(symbol)) return json({ error: "Enter a pair like BTCUSDT" }, 400);
  try {
    return json(await runAnalysis(env, symbol));
  } catch (e) {
    return json({ error: e.message || "analysis failed" }, 502);
  }
}

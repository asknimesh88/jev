// Narrative layer. With ANTHROPIC_API_KEY set, Claude writes the read-through; it cannot change levels or verdicts.
// Without a key, a rules-based summary is returned so the dashboard works out of the box.

const compact = (sig) => ({
  tf: sig.tf, verdict: sig.verdict, direction: sig.direction, confidence: sig.confidence, plan: sig.plan,
  note: sig.note, indicators: sig.indicators, reasons: sig.reasons.map((r) => `${r.bias}: ${r.text}`),
});

export function ruleNarrative(symbol, signals) {
  const lines = signals.map((s) => {
    const head = { ENTER_NOW: `${s.direction} is live`, WAIT: `${s.direction} setup — wait for the pullback`, MISSED: `${s.direction} move already happened — do not chase`, NO_TRADE: "no trade" }[s.verdict];
    return `${s.tf}: ${head} (${s.confidence}% confidence). ${s.note}`;
  });
  return lines.join("\n");
}

export async function aiNarrative(env, symbol, signals, ctx) {
  if (!env.ANTHROPIC_API_KEY) return { text: ruleNarrative(symbol, signals), by: "rules" };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 600,
        system:
          "You are Jev, a disciplined crypto trading analyst. You are given computed technicals, sentiment and fundamentals plus a rules-engine trade plan for each timeframe. " +
          "Write a tight briefing (max 160 words, plain text, no markdown headers): one line on overall market context, then one line per timeframe saying whether to act and why, then the single biggest risk. " +
          "Never invent numbers or change the entry/TP/SL or verdict. If the verdict is MISSED or NO_TRADE, say clearly to stay out. Be direct; no hype; no financial-advice boilerplate.",
        messages: [{ role: "user", content: JSON.stringify({ symbol, signals: signals.map(compact), fearGreed: ctx.fearGreed, derivatives: ctx.derivatives, fundamentals: ctx.fundamentals }) }],
      }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    const text = d.content?.map((b) => b.text || "").join("").trim();
    if (!text) throw new Error("empty");
    return { text, by: "claude" };
  } catch {
    return { text: ruleNarrative(symbol, signals), by: "rules" };
  }
}

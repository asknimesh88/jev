// Jev (TypeSafe System One) decision layer, called through the Composio API.
// Jev returns calibrated probabilities for each question; they decide whether the rules-engine plan is worth taking.
//
// Env: COMPOSIO_API_KEY (required to enable), JEV_CONNECTED_ACCOUNT_ID, COMPOSIO_USER_ID (optional), JEV_MODEL (default jev-latest)

const EXEC = "https://backend.composio.dev/api/v3/tools/execute/JEV_EVALUATE_STATE";

// Tunable gates
export const GATES = { minTpFirst: 0.5, maxOpposedDirection: 0.7, minChanceLeft: 0.3 };

const questions = (s) => ({
  direction: {
    type: "choice",
    criteria: {
      long: "Price is more likely to move up than down over the next several candles of this timeframe.",
      short: "Price is more likely to move down than up over the next several candles of this timeframe.",
      neutral: "No directional edge; the market is ranging or signals conflict.",
    },
    instructions: "Weigh trend, momentum, higher-timeframe context, positioning and fundamentals in the state. Do not assume the proposed plan is correct.",
  },
  tp_before_sl: {
    type: "noul",
    criteria: {
      true: `The proposed ${s.direction} trade plan hits TP1 before its stop loss.`,
      false: "The proposed trade plan hits its stop loss before TP1.",
    },
    instructions: "Judge the proposed plan in the state against the market evidence. Be skeptical of late, extended or low-reward entries.",
  },
  chance_left: {
    type: "noul",
    criteria: {
      true: "The entry is still attractive: price is near the value zone and most of the move is ahead.",
      false: "The opportunity has largely passed: price is extended and chasing it has poor odds.",
    },
  },
});

const stateOf = (symbol, s, ctx) => ({
  instrument: `${symbol} perpetual futures`,
  timeframe: s.tf, price: s.price, rules_engine_direction: s.direction, rules_engine_score: s.score,
  indicators: s.indicators, factor_scores: s.components,
  proposed_plan: { entry: s.plan.entry, entry_type: s.plan.entryType, stop_loss: s.plan.stopLoss, tp1: s.plan.tp1, tp2: s.plan.tp2, rr_tp1: s.plan.rr1 },
  signals: s.reasons.map((r) => `${r.bias}: ${r.text}`),
  funding_rate_pct: ctx.derivatives?.funding != null ? ctx.derivatives.funding * 100 : null,
  long_short_ratio: ctx.derivatives?.longShort ?? null,
  fear_greed: ctx.fearGreed?.value ?? null,
  fundamentals: ctx.fundamentals ? { rank: ctx.fundamentals.rank, change7d: ctx.fundamentals.change7d, change30d: ctx.fundamentals.change30d } : null,
});

async function evaluate(env, symbol, s, ctx) {
  const r = await fetch(EXEC, {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: { "content-type": "application/json", "x-api-key": env.COMPOSIO_API_KEY },
    body: JSON.stringify({
      connected_account_id: env.JEV_CONNECTED_ACCOUNT_ID || undefined,
      user_id: env.COMPOSIO_USER_ID || undefined,
      arguments: { model: env.JEV_MODEL || "jev-latest", state: stateOf(symbol, s, ctx), questions: questions(s) },
    }),
  });
  if (!r.ok) throw new Error(`composio ${r.status}`);
  const d = await r.json();
  const a = d.data?.answers ?? d.data?.data?.answers ?? d.data?.response_data?.answers;
  if (!a?.tp_before_sl) throw new Error("unexpected jev response");
  return {
    direction: a.direction.choice, dirConfidence: a.direction.confidence, dirProbs: a.direction.probabilities,
    tpFirst: a.tp_before_sl.noul, chanceLeft: a.chance_left.noul, model: d.data?.model,
  };
}

// Mutates `s` in place: attaches s.jev and applies Jev's gates to the verdict.
export async function applyJev(env, symbol, s, ctx) {
  if (!env.COMPOSIO_API_KEY) { s.jev = { used: false, reason: "COMPOSIO_API_KEY not set" }; return; }
  try {
    const j = await evaluate(env, symbol, s, ctx);
    s.jev = { used: true, ...j };
    const want = s.direction === "LONG" ? "long" : "short";
    const opposed = j.direction !== want && j.direction !== "neutral" ? j.dirProbs?.[j.direction] ?? 0 : 0;
    const live = s.verdict === "ENTER_NOW" || s.verdict === "WAIT";
    const jr = [];
    if (live && j.tpFirst < GATES.minTpFirst) { s.verdict = "NO_TRADE"; jr.push(`Jev puts TP1-before-stop at only ${Math.round(j.tpFirst * 100)}%.`); }
    else if (live && opposed >= GATES.maxOpposedDirection) { s.verdict = "NO_TRADE"; jr.push(`Jev disagrees: reads ${j.direction.toUpperCase()} at ${Math.round(opposed * 100)}%.`); }
    else if (live && j.chanceLeft < GATES.minChanceLeft) { s.verdict = "MISSED"; jr.push(`Jev says the opportunity has largely passed (${Math.round(j.chanceLeft * 100)}% left).`); }
    if (jr.length) s.note = jr.join(" ") + " " + s.note;
    // With Jev active, confidence is Jev's probability for the plan, not the rules-engine strength.
    s.confidence = Math.round(j.tpFirst * 100);
    s.confidenceSource = "jev";
  } catch (e) {
    s.jev = { used: false, reason: e.message };
  }
}

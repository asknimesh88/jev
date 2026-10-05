const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null || isNaN(n) ? "—" : n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n));
const big = (n) => (n == null ? "—" : n >= 1e12 ? (n / 1e12).toFixed(2) + "T" : n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n.toLocaleString());
const pct = (n, d = 1) => (n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(d) + "%");
const cls = (n) => (n > 0 ? "up" : n < 0 ? "dn" : "mut");

const VERDICT = {
  ENTER_NOW: { label: "ENTER NOW", cls: (s) => (s.direction === "LONG" ? "b-go-long" : "b-go-short"), card: (s) => (s.direction === "LONG" ? "live" : "short") },
  WAIT: { label: "WAIT FOR PULLBACK", cls: () => "b-wait", card: () => "wait" },
  MISSED: { label: "CHANCE GONE", cls: () => "b-dead", card: () => "dead" },
  NO_TRADE: { label: "NO TRADE", cls: () => "b-dead", card: () => "dead" },
};

let chart, current, activeTf = "15m", timer;

["BTCUSDT", "SOLUSDT", "ETHUSDT", "KASUSDT", "ALGOUSDT", "HBARUSDT", "QNTUSDT", "ONDOUSDT", "XLMUSDT", "XDCUSDT", "XRPUSDT"].forEach((s) => {
  const b = document.createElement("button");
  b.className = "chip"; b.textContent = s; b.type = "button";
  b.onclick = () => { $("sym").value = s; run(); };
  $("chips").appendChild(b);
});

$("form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
$("auto").addEventListener("change", (e) => {
  clearInterval(timer);
  if (e.target.checked) timer = setInterval(() => current && run(true), 60000);
});

const LOAD = ["Pulling candles across 4 timeframes…", "Computing indicators…", "Reading sentiment & funding…", "Checking fundamentals…", "Building the trade plan…"];

async function run(silent = false) {
  const symbol = $("sym").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) return;
  $("sym").value = symbol;
  $("error").hidden = true;
  let li;
  if (!silent) {
    $("empty").hidden = true; $("result").hidden = true; $("loading").hidden = false;
    let i = 0; $("loadtxt").textContent = LOAD[0];
    li = setInterval(() => ($("loadtxt").textContent = LOAD[++i % LOAD.length]), 900);
  }
  try {
    const r = await fetch("/api/analyze?symbol=" + encodeURIComponent(symbol));
    if (r.status === 401) return (location.href = "/login");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Analysis failed");
    current = d;
    if (!current.signals.find((s) => s.tf === activeTf)) activeTf = "15m";
    render(d);
  } catch (e) {
    $("error").hidden = false; $("error").textContent = e.message;
    if (!silent) $("empty").hidden = false;
  } finally {
    clearInterval(li); $("loading").hidden = true;
  }
}

function sigCard(s) {
  const v = VERDICT[s.verdict], p = s.plan, live = s.verdict === "ENTER_NOW" || s.verdict === "WAIT";
  const dirTxt = s.verdict === "NO_TRADE" ? "STAY OUT" : s.verdict === "MISSED" ? "MOVE IS OVER" : s.direction;
  const dirCls = s.verdict === "NO_TRADE" || s.verdict === "MISSED" ? "mut" : s.direction === "LONG" ? "up" : "dn";
  const lv = (k, label, val, sub, extra = "") =>
    `<div class="lv ${extra}" data-copy="${val}"><small>${label}</small><b>${fmt(val)}</b><em>${sub}</em></div>`;
  return `
  <div class="card sig ${v.card(s)}">
    <div class="row1"><span class="tf">${s.tf} signal</span><span class="badge ${v.cls(s)}">${v.label}</span></div>
    <div class="dir ${dirCls}">${dirTxt}</div>
    <p class="note">${esc(s.note)}</p>
    ${s.verdict === "MISSED" || s.verdict === "NO_TRADE" ? `<div class="dead-banner">${s.verdict === "MISSED" ? "The trade chance is gone. Do not chase — wait for a fresh setup." : "No trade on this timeframe."} Levels below are for reference only.</div>` : ""}
    <div class="conf"><div class="lbl"><span>${s.jev?.used ? "Jev · TP1 hits before stop" : "Confluence strength (Jev offline)"}</span><b>${s.confidence}%</b></div><div class="bar"><div style="width:${s.confidence}%"></div></div>
      ${s.jev?.used ? `<div class="jevline">Jev reads <b>${esc(s.jev.direction.toUpperCase())}</b> (${Math.round(s.jev.dirConfidence * 100)}%) · opportunity left ${Math.round(s.jev.chanceLeft * 100)}%</div>` : ""}</div>
    <div class="levels">
      ${lv("e", p.entryType === "LIMIT" ? "Entry (limit)" : "Entry", p.entry, p.entryType === "LIMIT" ? "wait for fill" : "market / now")}
      ${lv("sl", "Stop loss", p.stopLoss, `-${p.riskPct}%`, "sl")}
      ${lv("t1", "Take profit 1", p.tp1, `${p.rr1}R`, "tp")}
      ${lv("t2", "Take profit 2", p.tp2, `${p.rr2}R`, "tp")}
    </div>
    ${live ? `<div class="inv">⚑ ${esc(p.invalidation)}</div>` : ""}
  </div>`;
}

function comps(c) {
  const names = { trend: "Trend", momentum: "Momentum", htf: "Higher TF", structure: "Structure", sentiment: "Sentiment", fundamentals: "Fundamentals" };
  return Object.entries(names).map(([k, n]) => {
    const v = c[k] ?? 0, w = Math.abs(v) * 50;
    return `<div class="c"><span>${n}</span><div class="cbar"><i style="${v >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:var(${v >= 0 ? "--up" : "--dn"})"></i></div><span class="${cls(v)}">${v > 0 ? "+" : ""}${v.toFixed(2)}</span></div>`;
  }).join("");
}

function render(d) {
  const [a, b] = d.signals, T = d.signals.find((s) => s.tf === activeTf) || a;
  const f = d.fundamentals, dv = d.derivatives, fg = d.fearGreed;
  $("result").innerHTML = `
    <div class="head">
      <div><h2>${esc(d.symbol)} <small class="tag" style="font-size:12px">PERP</small></h2><span class="mut">via ${esc(d.source)} · ${d.jevActive ? "Jev active" : "Jev offline (rules only)"}</span></div>
      <div class="px">${fmt(d.price)} <small class="${cls(d.change24h)}" style="font-size:16px">${pct(d.change24h, 2)} 24h</small></div>
      <div class="meta"><button class="tab" id="tg" type="button">Send to Telegram</button><br>Analyzed ${new Date(d.generatedAt).toLocaleTimeString()}<br>Levels based on closed candles</div>
    </div>
    <div class="grid2">${sigCard(a)}${sigCard(b)}</div>

    <div class="card calc" id="calc">${calcHTML()}</div>
    <div class="card chartcard">
      <div class="tabs">${d.signals.map((s) => `<button class="tab ${s.tf === activeTf ? "on" : ""}" data-tf="${s.tf}">${s.tf}</button>`).join("")}</div>
      <div id="chart"></div>
    </div>

    <div class="grid3">
      <div class="card"><h3>Jev briefing <span class="tag">${d.narrative.by === "claude" ? "AI" : "rules"}</span></h3><div class="brief">${esc(d.narrative.text)}</div></div>
      <div class="card"><h3>Why · ${T.tf}</h3><ul class="r">${T.reasons.map((r) => `<li><span class="dot ${r.bias}"></span><span>${esc(r.text)}</span></li>`).join("")}</ul></div>
      <div class="card"><h3>Factor scores · ${T.tf}</h3><div class="comp">${comps(T.components)}</div></div>
    </div>

    <div class="grid3">
      <div class="card"><h3>Technicals · ${T.tf}</h3><div class="kv">
        <span>RSI</span><span>${T.indicators.rsi}</span><span>ADX</span><span>${T.indicators.adx}</span>
        <span>ATR</span><span>${fmt(T.indicators.atr)} (${T.indicators.atrPct}%)</span><span>Volume vs avg</span><span>${T.indicators.volRatio}×</span>
        <span>EMA 20 / 50</span><span>${fmt(T.indicators.ema20)} / ${fmt(T.indicators.ema50)}</span><span>EMA 200</span><span>${fmt(T.indicators.ema200)}</span>
        <span>Support</span><span>${fmt(T.indicators.support)}</span><span>Resistance</span><span>${fmt(T.indicators.resistance)}</span></div></div>
      <div class="card"><h3>Market sentiment</h3><div class="kv">
        <span>Fear &amp; Greed</span><span>${fg ? `${fg.value} · ${esc(fg.label)}` : "n/a"}</span>
        <span>Funding rate</span><span class="${dv?.funding > 0.0004 ? "warn" : ""}">${dv?.funding != null ? (dv.funding * 100).toFixed(4) + "%" : "n/a"}</span>
        <span>Long/Short ratio</span><span>${dv?.longShort?.toFixed(2) ?? "n/a"}</span>
        <span>Open interest</span><span>${dv?.openInterestValue ? "$" + big(dv.openInterestValue) : dv?.openInterest ? big(dv.openInterest) : "n/a"}</span></div></div>
      <div class="card"><h3>Fundamentals</h3>${f ? `<div class="kv">
        <span>Asset</span><span>${esc(f.name)}</span><span>Rank</span><span>#${f.rank ?? "—"}</span>
        <span>Market cap</span><span>$${big(f.marketCap)}</span><span>24h volume</span><span>$${big(f.volume24h)}</span>
        <span>7d / 30d</span><span><b class="${cls(f.change7d)}">${pct(f.change7d)}</b> / <b class="${cls(f.change30d)}">${pct(f.change30d)}</b></span>
        <span>From ATH</span><span class="dn">${pct(f.athChange)}</span>
        <span>Supply</span><span>${big(f.circulating)}${f.maxSupply ? " / " + big(f.maxSupply) : ""}</span></div>` : `<p class="mut">No fundamental data found for this pair.</p>`}</div>
    </div>`;
  $("result").hidden = false;

  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { activeTf = t.dataset.tf; render(current); }));
  document.querySelectorAll(".lv").forEach((el) => (el.onclick = () => { navigator.clipboard?.writeText(el.dataset.copy); toast("Copied " + el.dataset.copy); }));
  $("tg").onclick = async () => {
    const r = await fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: d.symbol }) });
    toast(r.ok ? "Sent to Telegram" : (await r.json()).error || "Telegram failed");
  };
  document.querySelectorAll("#calc input").forEach((i) => (i.oninput = () => { saveCalc(); updateCalc(); }));
  updateCalc();
  drawChart(T);
}

// ---------- Perp position calculator (risk-based sizing + liquidation check)
const MMR = 0.005; // approx. maintenance margin rate
const CK = "jev.calc";
const loadCalc = () => { try { return { bal: 1000, risk: 1, lev: 10, ...JSON.parse(localStorage.getItem(CK) || "{}") }; } catch { return { bal: 1000, risk: 1, lev: 10 }; } };
const saveCalc = () => { try { localStorage.setItem(CK, JSON.stringify({ bal: +$("c-bal").value, risk: +$("c-risk").value, lev: +$("c-lev").value })); } catch {} };
function calcHTML() {
  const c = loadCalc();
  return `<h3>Perp position sizing</h3>
  <div class="calcin">
    <label>Account (USDT)<input id="c-bal" type="number" min="1" value="${c.bal}"></label>
    <label>Risk per trade (%)<input id="c-risk" type="number" min="0.1" step="0.1" value="${c.risk}"></label>
    <label>Leverage (x)<input id="c-lev" type="number" min="1" max="125" value="${c.lev}"></label>
  </div><div class="calcout" id="c-out"></div>`;
}
function updateCalc() {
  if (!current) return;
  const bal = +$("c-bal").value, risk = +$("c-risk").value / 100, lev = +$("c-lev").value;
  $("c-out").innerHTML = current.signals.map((s) => {
    const p = s.plan, dist = Math.abs(p.entry - p.stopLoss), long = s.direction === "LONG";
    const qty = (bal * risk) / dist, notional = qty * p.entry, margin = notional / lev;
    const liq = long ? p.entry * (1 - 1 / lev + MMR) : p.entry * (1 + 1 / lev - MMR);
    const safe = long ? liq < p.stopLoss : liq > p.stopLoss;
    const maxLev = Math.max(1, Math.floor(1 / ((dist / p.entry) * 1.3 + MMR)));
    const dead = s.verdict === "MISSED" || s.verdict === "NO_TRADE";
    return `<div class="cc ${dead ? "dim" : ""}"><b>${s.tf} ${dead ? "(no trade)" : s.direction}</b>
      <div class="kv"><span>Risk</span><span>$${(bal * risk).toFixed(2)}</span><span>Size</span><span>${qty.toPrecision(4)} (${big(notional)} USDT)</span>
      <span>Margin used</span><span class="${margin > bal ? "dn" : ""}">${margin.toFixed(2)} USDT</span>
      <span>Est. liquidation</span><span class="${safe ? "" : "dn"}">${fmt(+liq.toPrecision(6))}</span>
      <span>Max leverage (liq beyond stop)</span><span>${maxLev}x</span></div>
      ${safe ? "" : `<div class="dn" style="font-size:12px;margin-top:6px">⚠ Liquidation is hit before your stop — lower leverage to ≤ ${maxLev}x.</div>`}</div>`;
  }).join("");
}

function drawChart(s) {
  const el = $("chart");
  if (!window.LightweightCharts) { el.innerHTML = '<p class="mut">Chart library failed to load.</p>'; return; }
  const L = window.LightweightCharts;
  chart = L.createChart(el, {
    height: 420, autoSize: true,
    layout: { background: { color: "transparent" }, textColor: "#8a94a8" },
    grid: { vertLines: { color: "#1a2130" }, horzLines: { color: "#1a2130" } },
    rightPriceScale: { borderColor: "#222a3a" }, timeScale: { borderColor: "#222a3a", timeVisible: true },
    crosshair: { mode: 0 },
  });
  const cs = chart.addCandlestickSeries({ upColor: "#25d09a", downColor: "#ff5d73", borderVisible: false, wickUpColor: "#25d09a", wickDownColor: "#ff5d73" });
  const C = s.chart.candles;
  cs.setData(C.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c })));
  const line = (arr, color) => {
    const ls = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ls.setData(arr.map((v, i) => (v == null ? null : { time: C[i].t, value: v })).filter(Boolean));
  };
  line(s.chart.ema20, "#7c9cff"); line(s.chart.ema50, "#ffb84d");
  if (s.verdict === "ENTER_NOW" || s.verdict === "WAIT") {
    const p = s.plan, pl = (price, color, title) => cs.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title });
    pl(p.entry, "#7c9cff", "ENTRY"); pl(p.stopLoss, "#ff5d73", "SL"); pl(p.tp1, "#25d09a", "TP1"); pl(p.tp2, "#25d09a", "TP2");
  }
  chart.timeScale().fitContent();
}

function toast(t) {
  const d = document.createElement("div"); d.className = "toast"; d.textContent = t;
  document.body.appendChild(d); setTimeout(() => d.remove(), 1400);
}

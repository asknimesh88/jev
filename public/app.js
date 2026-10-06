// ---------- helpers
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null || isNaN(n) ? "—" : Math.abs(n) >= 1000 ? Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n));
const big = (n) => (n == null || isNaN(n) ? "—" : n >= 1e12 ? (n / 1e12).toFixed(2) + "T" : n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(+n.toFixed(2)));
const pct = (n, d = 1) => (n == null || isNaN(n) ? "—" : (n > 0 ? "+" : "") + n.toFixed(d) + "%");
const cls = (n) => (n > 0 ? "up" : n < 0 ? "dn" : "mut");
const decimals = (x) => (x >= 1000 ? 2 : x >= 10 ? 3 : x >= 1 ? 4 : x >= 0.01 ? 6 : 8);
const store = {
  get(k, d) { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || "{}") }; } catch { return d; } },
  getArr(k) { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const toast = (t) => { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 1600); };
const TF_SEC = { "15m": 900, "1h": 3600 };

const VERDICT = {
  ENTER_NOW: (s) => ({ label: "ENTER NOW", cls: s.direction === "LONG" ? "go-long" : "go-short", short: "ENTER" }),
  WAIT: () => ({ label: "WAIT FOR PULLBACK", cls: "wait", short: "WAIT" }),
  MISSED: () => ({ label: "CHANCE GONE", cls: "dead", short: "GONE" }),
  NO_TRADE: () => ({ label: "NO TRADE", cls: "dead", short: "NO TRADE" }),
};
const vinfo = (s) => VERDICT[s.verdict](s);
const isLive = (s) => s.verdict === "ENTER_NOW" || s.verdict === "WAIT";

// ---------- state
const DEFAULTS = { bal: 1000, risk: 1, lev: 10, refresh: 60, watch: "BTCUSDT,SOLUSDT,ETHUSDT,KASUSDT,ALGOUSDT,HBARUSDT,QNTUSDT,ONDOUSDT,XLMUSDT,XDCUSDT,XRPUSDT" };
let S = store.get("jev.settings", DEFAULTS);
let cache = store.get("jev.cache", {});          // symbol → {t, price, change24h, v15:{verdict,direction,prob}, v1h:{...}}
let current = null, activeTf = "15m", timer = null, view = "dash", charts = null;
const ov = store.get("jev.overlays", { ema: true, bb: false, sr: true, vol: true, smc: true });
const watchList = () => S.watch.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);

// ---------- navigation
document.querySelectorAll(".nav").forEach((b) => (b.onclick = () => go(b.dataset.view)));
function go(v) {
  view = v;
  document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  ["dash", "scan", "set"].forEach((k) => ($("view-" + k).hidden = k !== v));
  if (v === "scan") renderScan();
  if (v === "set") renderSettings();
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); go("dash"); run(); });
$("run").onclick = () => { go("dash"); run(); };
$("tfseg").onclick = (e) => { const tf = e.target.dataset?.tf; if (tf) setTf(tf); };
function setTf(tf) {
  activeTf = tf;
  document.querySelectorAll("#tfseg button").forEach((b) => b.classList.toggle("on", b.dataset.tf === tf));
  if (current) { renderCenter(current); renderRight(current); }
}
$("auto").onchange = (e) => {
  clearInterval(timer);
  if (e.target.checked) timer = setInterval(() => current && view === "dash" && run(true), S.refresh * 1000);
};

// ---------- sidebar watchlist + chips
function renderWatch() {
  $("watch").innerHTML = watchList().map((s) => {
    const c = cache[s], d = (v) => `<i class="vd ${v ? VERDICT[v.verdict]({ direction: v.direction }).cls : ""}"></i>`;
    return `<button class="w ${current?.symbol === s ? "on" : ""}" data-s="${s}"><span class="mono">${s.replace(/USDT$|USDC$/, "")}<span class="mut">/${s.endsWith("USDC") ? "USDC" : "USDT"}</span></span><span class="dots">${d(c?.v15)}${d(c?.v1h)}</span></button>`;
  }).join("");
  document.querySelectorAll(".w").forEach((b) => (b.onclick = () => { $("sym").value = b.dataset.s; go("dash"); run(); }));
  $("chips").innerHTML = watchList().map((s) => `<button class="chip" type="button" data-s="${s}">${s}</button>`).join("");
  document.querySelectorAll(".chip").forEach((b) => (b.onclick = () => { $("sym").value = b.dataset.s; run(); }));
}

// ---------- fetch
const LOAD = ["Pulling perp candles across 4 timeframes…", "Computing indicators…", "Reading funding & positioning…", "Checking fundamentals…", "Asking Jev for the odds…"];
async function fetchAnalysis(symbol) {
  const r = await fetch("/api/analyze?symbol=" + encodeURIComponent(symbol));
  if (r.status === 401) { location.href = "/login"; throw new Error("Session expired"); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Analysis failed");
  remember(d);
  return d;
}
function remember(d) {
  const v = (s) => ({ verdict: s.verdict, direction: s.direction, prob: s.confidence, jev: !!s.jev?.used });
  cache[d.symbol] = { t: Date.now(), price: d.price, change24h: d.change24h, funding: d.derivatives?.funding, v15: v(d.signals[0]), v1h: v(d.signals[1]) };
  store.set("jev.cache", cache);
  // signal log: record only when verdict changes
  const log = store.getArr("jev.log");
  d.signals.forEach((s) => {
    const prev = log.find((x) => x.symbol === d.symbol && x.tf === s.tf);
    if (!prev || prev.verdict !== s.verdict || prev.direction !== s.direction) log.unshift({ t: Date.now(), symbol: d.symbol, tf: s.tf, verdict: s.verdict, direction: s.direction, prob: s.confidence });
  });
  store.set("jev.log", log.slice(0, 40));
}
async function run(silent = false) {
  const symbol = $("sym").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) return;
  $("sym").value = symbol; $("error").hidden = true;
  let li;
  if (!silent) {
    $("empty").hidden = true; $("center").hidden = true; $("loading").hidden = false;
    let i = 0; $("loadtxt").textContent = LOAD[0];
    li = setInterval(() => ($("loadtxt").textContent = LOAD[++i % LOAD.length]), 900);
  }
  try {
    current = await fetchAnalysis(symbol);
    $("upd").textContent = "Updated " + new Date(current.generatedAt).toLocaleTimeString();
    $("jevdot").className = "sdot " + (current.jevActive ? "on" : "off");
    $("jevtxt").textContent = current.jevActive ? "Jev engine online" : "Jev offline · rules only";
    renderCenter(current); renderRight(current); renderWatch();
  } catch (e) {
    $("error").hidden = false; $("error").textContent = e.message;
    if (!silent && !current) $("empty").hidden = false;
  } finally { clearInterval(li); $("loading").hidden = true; }
}

// ---------- helpers for signal text
const sigOf = (d) => d.signals.find((s) => s.tf === activeTf) || d.signals[0];
const trendLabel = (v) => (v > 0.35 ? "Bullish" : v < -0.35 ? "Bearish" : "Neutral");
const trendCls = (v) => (v > 0.35 ? "bull" : v < -0.35 ? "bear" : "neutral");

function techRows(s, price) {
  const i = s.indicators, rows = [];
  const R = (name, val, bias, label) => rows.push({ name, val, bias, label });
  R("Price vs EMA 20", fmt(i.ema20), price > i.ema20 ? "bull" : "bear", price > i.ema20 ? "Above" : "Below");
  R("Price vs EMA 50", fmt(i.ema50), price > i.ema50 ? "bull" : "bear", price > i.ema50 ? "Above" : "Below");
  if (i.ema200 != null) R("Price vs EMA 200", fmt(i.ema200), price > i.ema200 ? "bull" : "bear", price > i.ema200 ? "Above" : "Below");
  R("RSI (14)", i.rsi, i.rsi > 70 ? "bear" : i.rsi < 30 ? "bull" : i.rsi > 52 ? "bull" : i.rsi < 48 ? "bear" : "neutral", i.rsi > 70 ? "Overbought" : i.rsi < 30 ? "Oversold" : i.rsi > 52 ? "Bullish" : i.rsi < 48 ? "Bearish" : "Neutral");
  R("MACD histogram", fmt(i.macdHist), i.macdHist > 0 ? "bull" : "bear", i.macdHist > 0 ? "Positive" : "Negative");
  R("ADX / DI", `${i.adx} · ${i.pdi}/${i.mdi}`, i.adx < 18 ? "neutral" : i.pdi > i.mdi ? "bull" : "bear", i.adx < 18 ? "Weak" : i.adx > 25 ? "Strong" : "Building");
  R("Bollinger %B", i.bbPos, i.bbPos > 0.9 ? "bear" : i.bbPos < 0.1 ? "bull" : "neutral", i.bbPos > 0.9 ? "Upper band" : i.bbPos < 0.1 ? "Lower band" : "Mid-range");
  R("Volume vs 20-avg", i.volRatio + "×", i.volRatio > 1.3 ? "bull" : "neutral", i.volRatio > 1.3 ? "Elevated" : i.volRatio < 0.7 ? "Thin" : "Normal");
  R("ATR (volatility)", `${fmt(i.atr)} · ${i.atrPct}%`, "neutral", i.atrPct > 2 ? "High" : i.atrPct < 0.5 ? "Low" : "Normal");
  return rows;
}

// ---------- CENTER (market strip, chart, analysis)
function renderCenter(d) {
  const s = sigOf(d), dv = d.derivatives, fg = d.fearGreed, f = d.fundamentals, st = d.stats24;
  const v = vinfo(s), tech = techRows(s, s.price);
  const nb = tech.filter((r) => r.bias === "bull").length, nr = tech.filter((r) => r.bias === "bear").length, nn = tech.length - nb - nr;
  const macro = d.mtf.find((m) => m.tf === "1d"), h4 = d.mtf.find((m) => m.tf === "4h");
  const phase = s.indicators.rsi > 70 ? "Extended" : s.indicators.rsi < 30 ? "Capitulation" : s.verdict === "WAIT" ? "Pullback" : s.indicators.adx > 25 ? "Impulse" : "Range";
  const lad = ladder(s, d.price);
  const log = store.getArr("jev.log").filter((x) => x.symbol === d.symbol).slice(0, 8);

  $("center").innerHTML = `
  <div class="strip">
    <div class="stat px"><small>${esc(d.symbol)} perp</small><b>${fmt(d.price)}</b><em class="${cls(d.change24h)}">${pct(d.change24h, 2)} · 24h</em></div>
    <div class="stat"><small>24h high</small><b>${fmt(st.high)}</b><em>${pct(((d.price - st.high) / st.high) * 100, 2)} away</em></div>
    <div class="stat"><small>24h low</small><b>${fmt(st.low)}</b><em>${pct(((d.price - st.low) / st.low) * 100, 2)} above</em></div>
    <div class="stat"><small>24h volume</small><b>$${big(st.volume)}</b><em>${esc(d.source)}</em></div>
    <div class="stat"><small>Funding</small><b class="${dv?.funding > 0.0004 ? "warn" : dv?.funding < -0.0002 ? "up" : ""}">${dv?.funding != null ? (dv.funding * 100).toFixed(4) + "%" : "—"}</b><em>${dv?.funding > 0.0004 ? "longs crowded" : dv?.funding < -0.0002 ? "shorts crowded" : "neutral"}</em></div>
    <div class="stat"><small>Open interest</small><b>${dv?.openInterestValue ? "$" + big(dv.openInterestValue) : dv?.openInterest ? big(dv.openInterest) : "—"}</b><em>L/S ${dv?.longShort?.toFixed(2) ?? "—"}</em></div>
    <div class="stat"><small>Fear &amp; Greed</small><b>${fg ? fg.value : "—"}</b><em>${fg ? esc(fg.label) : ""}</em></div>
  </div>

  <div class="card chartcard">
    <div class="chartbar">
      <div class="seg" id="ctf">${d.signals.map((x) => `<button data-tf="${x.tf}" class="${x.tf === activeTf ? "on" : ""}">${x.tf}</button>`).join("")}</div>
      <div class="chartsum">
        <div><small>SIGNAL</small><b class="${v.cls === "go-long" ? "up" : v.cls === "go-short" ? "dn" : v.cls === "wait" ? "warn" : "mut"}">${v.short}</b></div>
        <div><small>DAILY TREND</small><b class="${macro.trend > 0.35 ? "up" : macro.trend < -0.35 ? "dn" : "mut"}">${trendLabel(macro.trend)}</b></div>
        <div><small>4H TREND</small><b class="${h4.trend > 0.35 ? "up" : h4.trend < -0.35 ? "dn" : "mut"}">${trendLabel(h4.trend)}</b></div>
        <div><small>PHASE</small><b>${phase.toUpperCase()}</b></div>
      </div>
      <div class="ovl" id="ovl">${[["smc", "SMC"], ["ema", "EMA"], ["bb", "Bands"], ["sr", "S/R"], ["vol", "Volume"]].map(([k, n]) => `<button data-k="${k}" class="${ov[k] ? "on" : ""}">${n}</button>`).join("")}</div>
    </div>
    ${ov.smc ? `<div class="legend"><span><i class="sw" style="--c:#22d3a0"></i>Demand OB</span><span><i class="sw" style="--c:#ff5c75"></i>Supply OB</span><span><i class="ln"></i>BOS</span><span><i class="ln ch"></i>CHoCH</span><span class="yl">◆ Liquidity sweep</span><span><i class="ln dot"></i>EQH / EQL pool</span></div>` : ""}
    <div class="cw"><div id="chart"></div><canvas id="smccv"></canvas></div>
    <div style="position:relative"><span class="rsilbl" style="top:6px">RSI 14</span><div id="rsichart"></div></div>
  </div>

  <div id="right" class="mt"></div>

  <div class="grid g2 mt">
    <div class="card"><h3>Jev briefing <span class="tag">${d.narrative?.by === "claude" ? "AI" : "rules"}</span></h3><div class="brief">${esc(d.narrative?.text)}</div></div>
    <div class="card"><h3>Multi-timeframe trend</h3><div class="mtf">${d.mtf.map((m) => `
      <div class="mtfrow"><b>${m.tf}</b><div class="tbar"><i style="${m.trend >= 0 ? "left:50%" : `left:${50 + m.trend * 50}%`};width:${Math.abs(m.trend) * 50}%;background:var(${m.trend >= 0 ? "--up" : "--dn"})"></i></div>
      <span class="pill ${trendCls(m.trend)}">${trendLabel(m.trend).toUpperCase()}</span><span class="mut mono">RSI ${m.rsi}</span><span class="mut mono">ADX ${m.adx}</span></div>`).join("")}</div>
      <p class="mut" style="font-size:12px;margin:12px 0 0">Alignment across timeframes is the single biggest factor in Jev's read: ${d.mtf.filter((m) => m.trend > 0.35).length} bullish · ${d.mtf.filter((m) => m.trend < -0.35).length} bearish of 4.</p></div>
  </div>

  <div class="grid g3 mt">
    <div class="card"><h3>Why · ${s.tf}</h3><ul class="r">${s.reasons.map((r) => `<li><span class="dot ${r.bias}"></span><span>${esc(r.text)}</span></li>`).join("")}</ul></div>
    <div class="card"><h3>Key levels · ${s.tf}</h3><div class="ladder">${lad}</div></div>
    <div class="card"><h3>Technical readout · ${s.tf}</h3>
      <div class="consensus"><i style="width:${(nb / tech.length) * 100}%"></i><i style="width:${(nn / tech.length) * 100}%"></i><i style="width:${(nr / tech.length) * 100}%"></i></div>
      <div class="mut" style="font-size:12px;margin-bottom:6px"><b class="up">${nb} bullish</b> · ${nn} neutral · <b class="dn">${nr} bearish</b></div>
      <div class="tt">${tech.map((r) => `<div class="tr"><span>${r.name}</span><b>${r.val}</b><span class="pill ${r.bias}">${r.label.toUpperCase()}</span></div>`).join("")}</div></div>
  </div>

  <div class="grid g3 mt">
    <div class="card"><h3>Market sentiment</h3>
      ${fg ? `<div class="mut" style="font-size:12px">Fear &amp; Greed · <b style="color:var(--txt)">${fg.value} ${esc(fg.label)}</b>${fg.previous != null ? ` (prev ${fg.previous})` : ""}</div><div class="fbar"><i style="left:calc(${fg.value}% - 2px)"></i></div>` : ""}
      <div class="kv"><span>Funding rate</span><span>${dv?.funding != null ? (dv.funding * 100).toFixed(4) + "%" : "n/a"}</span>
      <span>Long / Short</span><span>${dv?.longShort?.toFixed(2) ?? "n/a"}</span>
      <span>Open interest</span><span>${dv?.openInterestValue ? "$" + big(dv.openInterestValue) : "n/a"}</span>
      <span>Mark price</span><span>${fmt(dv?.markPrice)}</span><span>Data source</span><span>${esc(dv?.source ?? "n/a")}</span></div></div>
    <div class="card"><h3>Fundamentals</h3>${f ? `<div class="kv">
      <span>Asset</span><span>${esc(f.name)}</span><span>Market-cap rank</span><span>#${f.rank ?? "—"}</span>
      <span>Market cap</span><span>$${big(f.marketCap)}</span><span>24h volume</span><span>$${big(f.volume24h)}</span>
      <span>Volume / mcap</span><span>${f.volumeToMcap != null ? (f.volumeToMcap * 100).toFixed(1) + "%" : "—"}</span>
      <span>7d / 30d</span><span><b class="${cls(f.change7d)}">${pct(f.change7d)}</b> / <b class="${cls(f.change30d)}">${pct(f.change30d)}</b></span>
      <span>1y</span><span class="${cls(f.change1y)}">${pct(f.change1y, 0)}</span><span>From ATH</span><span class="dn">${pct(f.athChange)}</span>
      <span>Circulating</span><span>${big(f.circulating)}${f.maxSupply ? ` / ${big(f.maxSupply)}` : ""}</span></div>
      ${f.categories?.length ? `<p style="margin:12px 0 0">${f.categories.map((c) => `<span class="tag">${esc(c)}</span>`).join(" ")}</p>` : ""}` : `<p class="mut">No fundamental data found for this pair.</p>`}</div>
    <div class="card"><h3>Signal log · ${esc(d.symbol)}</h3><div class="log">${log.length ? log.map((x) => {
      const info = VERDICT[x.verdict]({ direction: x.direction });
      return `<div class="logr"><time>${new Date(x.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><span class="vb ${info.cls}">${info.short}</span><span class="mono">${x.tf}</span><span>${x.verdict === "NO_TRADE" || x.verdict === "MISSED" ? "" : x.direction}</span><span class="mut mono">${x.prob}%</span></div>`;
    }).join("") : `<p class="mut">Changes in verdict will be logged here.</p>`}</div></div>
  </div>`;
  $("center").hidden = false;
  $("ctf").onclick = (e) => { const tf = e.target.dataset?.tf; if (tf) setTf(tf); };
  $("ovl").onclick = (e) => { const k = e.target.dataset?.k; if (!k) return; ov[k] = !ov[k]; store.set("jev.overlays", ov); renderCenter(current); };
  drawCharts(s);
}

function ladder(s, price) {
  const items = [];
  const p = s.plan, i = s.indicators, live = isLive(s);
  s.levels.forEach((l) => items.push({ price: l.price, t: l.type === "resistance" ? "Resistance" : "Support", c: l.type === "resistance" ? "res" : "sup" }));
  [["EMA 20", i.ema20], ["EMA 50", i.ema50], ["EMA 200", i.ema200]].forEach(([t, x]) => x != null && items.push({ price: x, t, c: "ma" }));
  if (live) [["Take profit 2", p.tp2, "plan tp"], ["Take profit 1", p.tp1, "plan tp"], ["Entry", p.entry, "plan en"], ["Stop loss", p.stopLoss, "plan sl"]].forEach(([t, x, c]) => items.push({ price: x, t, c }));
  items.push({ price, t: "Price now", c: "px" });
  return items.sort((a, b) => b.price - a.price).map((x) => `<div class="lad ${x.c}"><span class="t">${x.t}</span><span>${fmt(x.price)}</span><span class="d">${x.c === "px" ? "" : pct(((x.price - price) / price) * 100, 2)}</span></div>`).join("");
}

// ---------- smart-money overlay (canvas on top of the chart: order blocks, BOS/CHoCH, sweeps, EQH/EQL)
let smcRaf = 0;
function startSmc(ch, cs, sm, C, off) {
  const cv = $("smccv"); if (!cv || !sm) return;
  const ctx = cv.getContext("2d"), ts = ch.timeScale(), last = C.length - 1;
  const X = (i) => ts.timeToCoordinate(C[Math.max(0, Math.min(i, last))].t + off), Y = (p) => cs.priceToCoordinate(p);
  const UP = "#22d3a0", DN = "#ff5c75", AMB = "#ffb547", GRY = "#9fb0cc", YL = "#ffe066";
  let sig = "";
  const draw = (w, h, dpr) => {
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!ov.smc) return;
    const xr = ts.width(); ctx.font = "600 10px ui-monospace, monospace"; ctx.textBaseline = "middle";
    const seg = (x1, x2, y, col, dash, label, above = true) => {
      ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
      if (label) { ctx.fillStyle = col; ctx.textAlign = "center"; ctx.fillText(label, (x1 + x2) / 2, y + (above ? -8 : 8)); }
    };
    sm.obs.forEach((o) => {
      const y1 = Y(o.hi), y2 = Y(o.lo); if (y1 == null || y2 == null) return;
      const x1 = X(o.i) ?? 0, col = o.dir === "bull" ? UP : DN;
      ctx.fillStyle = col + "26"; ctx.fillRect(x1, y1, xr - x1, y2 - y1);
      ctx.strokeStyle = col + "99"; ctx.lineWidth = 1; ctx.strokeRect(x1, y1, xr - x1, y2 - y1);
      ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(o.dir === "bull" ? "OB demand" : "OB supply", x1 + 5, y1 + 9);
    });
    sm.pools.forEach((p) => { const y = Y(p.level); if (y == null) return; seg(X(p.from) ?? 0, xr, y, YL + "aa", [2, 4], null); ctx.fillStyle = YL; ctx.textAlign = "right"; ctx.fillText(p.side, xr - 4, y + (p.side === "EQH" ? -8 : 8)); });
    sm.breaks.forEach((b) => { const y = Y(b.level); if (y == null) return; seg(X(b.from) ?? 0, X(b.i) ?? xr, y, b.type === "CHoCH" ? AMB : GRY, [6, 4], b.type, b.dir === "bull"); });
    sm.sweeps.forEach((q) => {
      const y = Y(q.level), x = X(q.i); if (y == null || x == null) return;
      seg(X(q.from) ?? 0, x, y, YL + "88", [2, 3], null);
      ctx.fillStyle = YL; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.fill();
      ctx.textAlign = "center"; ctx.fillText("SWEEP", x, y + (q.side === "bsl" ? -13 : 13));
    });
  };
  const frame = () => {
    if (!cv.isConnected) return;
    const w = cv.parentElement.clientWidth, h = cv.parentElement.clientHeight, dpr = window.devicePixelRatio || 1;
    const now = [w, h, X(0), X(last), Y(C[last].c), Y(C[0].c), ov.smc].join("|");
    if (now !== sig) { sig = now; draw(w, h, dpr); }
    smcRaf = requestAnimationFrame(frame);
  };
  frame();
}

// ---------- charts
function drawCharts(s) {
  const el = $("chart"), rel = $("rsichart");
  if (!window.LightweightCharts) { el.innerHTML = '<p class="mut" style="padding:20px">Chart library failed to load. Hard-refresh (Ctrl+Shift+R); if it persists, open /lightweight-charts.js to check it is served.</p>'; return; }
  const L = window.LightweightCharts, off = -new Date().getTimezoneOffset() * 60, C = s.chart.candles, prec = decimals(s.price);
  const base = { autoSize: true, layout: { background: { color: "transparent" }, textColor: "#8793a8", fontFamily: "ui-monospace, monospace" },
    grid: { vertLines: { color: "#141c2b" }, horzLines: { color: "#141c2b" } }, rightPriceScale: { borderColor: "#1f2a3d" },
    timeScale: { borderColor: "#1f2a3d", timeVisible: true, secondsVisible: false }, crosshair: { mode: 0 } };
  cancelAnimationFrame(smcRaf);
  if (charts) { try { charts.ch.remove(); charts.rc.remove(); } catch {} }
  const ch = L.createChart(el, base), rc = L.createChart(rel, { ...base, timeScale: { ...base.timeScale, visible: false } });
  const fmtP = { type: "price", precision: prec, minMove: Math.pow(10, -prec) };
  const cs = ch.addCandlestickSeries({ upColor: "#22d3a0", downColor: "#ff5c75", borderVisible: false, wickUpColor: "#22d3a0", wickDownColor: "#ff5c75", priceFormat: fmtP });
  const T = (i) => C[i].t + off;
  cs.setData(C.map((c, i) => ({ time: T(i), open: c.o, high: c.h, low: c.l, close: c.c })));
  const line = (c, arr, color, w = 1, style = 0) => { const ls = c.addLineSeries({ color, lineWidth: w, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmtP }); ls.setData(arr.map((v, i) => (v == null ? null : { time: T(i), value: v })).filter(Boolean)); return ls; };
  if (ov.ema) { line(ch, s.chart.ema20, "#35a7ff", 1.5); line(ch, s.chart.ema50, "#ffb547", 1.5); line(ch, s.chart.ema200, "#b784ff", 1.5); }
  if (ov.bb) { line(ch, s.chart.bbUp, "#5b667b", 1, 2); line(ch, s.chart.bbLo, "#5b667b", 1, 2); }
  if (ov.vol) {
    const vs = ch.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false });
    ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vs.setData(C.map((c, i) => ({ time: T(i), value: c.v, color: c.c >= c.o ? "#22d3a033" : "#ff5c7533" })));
  }
  const pl = (price, color, title, style = 2) => cs.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
  if (ov.sr) s.levels.forEach((l) => pl(l.price, l.type === "resistance" ? "#ff5c7566" : "#22d3a066", l.type === "resistance" ? "R" : "S", 3));
  if (isLive(s)) { const p = s.plan; pl(p.entry, "#35a7ff", "ENTRY"); pl(p.stopLoss, "#ff5c75", "SL"); pl(p.tp1, "#22d3a0", "TP1"); pl(p.tp2, "#22d3a0", "TP2"); }
  // RSI pane
  const rs = line(rc, s.chart.rsi, "#b784ff", 1.5); rs.applyOptions({ priceFormat: { type: "price", precision: 0, minMove: 1 } });
  [70, 30].forEach((x) => rs.createPriceLine({ price: x, color: "#3a4660", lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
  rc.priceScale("right").applyOptions({ autoScale: false, scaleMargins: { top: 0.08, bottom: 0.08 } });
  rs.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
  ch.timeScale().fitContent();
  ch.timeScale().subscribeVisibleLogicalRangeChange((r) => r && rc.timeScale().setVisibleLogicalRange(r));
  rc.timeScale().setVisibleLogicalRange(ch.timeScale().getVisibleLogicalRange() || { from: 0, to: C.length });
  charts = { ch, rc };
  startSmc(ch, cs, s.chart.smc, C, off);
}

// ---------- RIGHT panel (signal, Jev, scenarios, levels, sizing)
function renderRight(d) {
  const s = sigOf(d), v = vinfo(s), live = isLive(s), p = s.plan, j = s.jev;
  const dirTxt = s.verdict === "NO_TRADE" ? "STAND ASIDE" : s.verdict === "MISSED" ? "DO NOT CHASE" : `${s.direction} ${d.symbol.replace(/USDT$|USDC$/, "")}`;
  const sup = s.indicators.support, res = s.indicators.resistance, long = s.direction === "LONG";
  const prim = live
    ? `${long ? "Buy" : "Sell short"} ${p.entryType === "LIMIT" ? `with a limit at <b>${fmt(p.entry)}</b>` : `at market near <b>${fmt(p.entry)}</b>`}. Stop <b>${fmt(p.stopLoss)}</b> (−${p.riskPct}%). Take half at TP1 (${p.rr1}R), move the stop to breakeven, trail the rest toward TP2 (${p.rr2}R).`
    : s.verdict === "MISSED" ? "The clean entry has passed. Chasing here gives up the edge — wait for price to reset toward the EMA 20 or for a fresh setup on the next candle close."
    : "There's no edge worth risking capital on. Stay flat and re-check at the next candle close.";
  const alt = long
    ? `If price closes below support <b>${fmt(sup)}</b>, the bullish read is invalid — flip to neutral and only reconsider shorts on a retest from below.`
    : `If price closes above resistance <b>${fmt(res)}</b>, the bearish read is invalid — flip to neutral and only reconsider longs on a retest from above.`;
  const total = p.rr2 + 1, rrw = (x) => (x / total) * 100;

  const circ = 2 * Math.PI * 34;
  const jevBlock = j?.used ? `
    <div class="jev"><div class="ring"><svg width="84" height="84"><circle cx="42" cy="42" r="34" fill="none" stroke="#1a2334" stroke-width="8"/><circle cx="42" cy="42" r="34" fill="none" stroke="${s.confidence >= 60 ? "#22d3a0" : s.confidence >= 50 ? "#ffb547" : "#ff5c75"}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(s.confidence / 100) * circ} ${circ}"/></svg><b>${s.confidence}%</b></div>
    <div class="jevtxt"><span>TP1 before stop</span><span>Jev reads <b>${esc(j.direction.toUpperCase())}</b> · ${Math.round(j.dirConfidence * 100)}% sure</span><span>Opportunity left <b>${Math.round(j.chanceLeft * 100)}%</b></span><span style="font-size:11px;color:var(--dim)">${esc(j.model || "jev")}</span></div></div>`
    : `<div class="jev"><div class="ring"><svg width="84" height="84"><circle cx="42" cy="42" r="34" fill="none" stroke="#1a2334" stroke-width="8"/><circle cx="42" cy="42" r="34" fill="none" stroke="#ffb547" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(s.confidence / 100) * circ} ${circ}"/></svg><b>${s.confidence}%</b></div>
    <div class="jevtxt"><span><b class="warn">Jev offline</b> — showing rules-engine strength.</span><span style="font-size:11px">${esc(j?.reason || "")}</span></div></div>`;

  // sizing
  const bal = +S.bal, risk = +S.risk / 100, lev = +S.lev, dist = Math.abs(p.entry - p.stopLoss);
  const qty = (bal * risk) / dist, notional = qty * p.entry, margin = notional / lev;
  const MMR = 0.005, liq = long ? p.entry * (1 - 1 / lev + MMR) : p.entry * (1 + 1 / lev - MMR);
  const safe = long ? liq < p.stopLoss : liq > p.stopLoss;
  const maxLev = Math.max(1, Math.floor(1 / ((dist / p.entry) * 1.3 + MMR)));

  $("right").innerHTML = `
    <div class="plan">
      <div class="plan-bar"><div class="minis">${d.signals.map((x) => { const vi = vinfo(x); return `<button class="mini ${x.tf === activeTf ? "on" : ""}" data-tf="${x.tf}"><small>${x.tf}</small><b class="${vi.cls === "go-long" ? "up" : vi.cls === "go-short" ? "dn" : vi.cls === "wait" ? "warn" : "mut"}">${vi.short}${isLive(x) ? " · " + x.direction : ""}</b></button>`; }).join("")}</div>
        <span class="rtitle">TRADE PLAN · ${esc(d.symbol)} ${s.tf}</span><button class="btn2" id="tg">✈ Send to Telegram</button></div>
      <div class="plan-main">
        <div class="hero ${v.cls}"><small>${s.tf} SIGNAL</small><div class="hv">${v.label}</div><div class="hd">${esc(dirTxt)}</div><div class="hn">${esc(s.note)}</div></div>
        <div class="plan-lv">
          <div class="lv4">
            <div class="lvl e ${live ? "" : "off"}" data-copy="${p.entry}"><div class="ic">◎</div><div><small>Entry</small><b>${fmt(p.entry)}</b><em>${live ? (p.entryType === "LIMIT" ? "limit · wait for fill" : "market · now") : "ref only"}</em></div></div>
            <div class="lvl s ${live ? "" : "off"}" data-copy="${p.stopLoss}"><div class="ic">✕</div><div><small>Stop loss</small><b>${fmt(p.stopLoss)}</b><em>−${p.riskPct}%</em></div></div>
            <div class="lvl t ${live ? "" : "off"}" data-copy="${p.tp1}"><div class="ic">✓</div><div><small>TP 1</small><b>${fmt(p.tp1)}</b><em>${p.rr1}R</em></div></div>
            <div class="lvl t ${live ? "" : "off"}" data-copy="${p.tp2}"><div class="ic">✓✓</div><div><small>TP 2</small><b>${fmt(p.tp2)}</b><em>${p.rr2}R</em></div></div>
          </div>
          <div class="rr ${live ? "" : "off"}"><div class="a" style="width:${rrw(1)}%">RISK</div><div class="b" style="width:${rrw(p.rr1)}%">TP1 ${p.rr1}R</div><div class="c" style="width:${rrw(p.rr2 - p.rr1)}%">TP2 ${p.rr2}R</div></div>
          ${live ? `<div class="mut" style="font-size:11.5px">⚑ ${esc(p.invalidation)}</div>` : ""}
        </div>
        <div class="plan-side">
          <div class="cdcard"><small>${s.tf} CANDLE CLOSES IN</small><div class="cd" id="cd">--:--</div><p>${live ? "Re-evaluated at every close." : "Next decision point."}</p></div>
          <div class="card" style="padding:12px">${jevBlock}</div>
        </div>
      </div>
      <div class="grid g3 mt">
        <div class="card"><h3>Trade scenarios</h3>
          <div class="scn"><h4><span>${live ? "Primary plan" : "Current stance"}</span><span class="tag">${live ? s.direction : "FLAT"}</span></h4>${prim}</div>
          <div class="scn alt" style="margin-top:10px"><h4><span>If it goes wrong</span></h4>${alt}</div></div>
        <div class="card"><h3>Perp position sizing</h3><div class="calc ${live ? "" : "off"}">
          <span>Risk (${S.risk}% of $${fmt(S.bal)})</span><span>$${(bal * risk).toFixed(2)}</span>
          <span>Position size</span><span>${qty.toPrecision(4)} (${big(notional)})</span>
          <span>Margin @ ${lev}x</span><span class="${margin > bal ? "dn" : ""}">$${margin.toFixed(2)}</span>
          <span>Est. liquidation</span><span class="${safe ? "" : "dn"}">${fmt(+liq.toPrecision(6))}</span>
          <span>Max safe leverage</span><span>${maxLev}x</span></div>
          ${safe ? "" : `<div class="dn" style="font-size:12px;margin-top:8px">⚠ Liquidation would hit before your stop. Use ≤ ${maxLev}x.</div>`}
          <div class="mut" style="font-size:11px;margin-top:8px">Edit account / risk / leverage in Settings.</div></div>
        <div class="card"><h3>Factor scores · ${s.tf}</h3><div class="comp">${compBars(s.components)}</div></div>
      </div>
    </div>`;
  document.querySelectorAll(".mini").forEach((b) => (b.onclick = () => setTf(b.dataset.tf)));
  document.querySelectorAll(".lvl").forEach((b) => (b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast("Copied " + b.dataset.copy); }));
  $("tg").onclick = async () => {
    const r = await fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: d.symbol }) });
    toast(r.ok ? "Sent to Telegram" : (await r.json()).error || "Telegram failed");
  };
  tick();
}
function compBars(c) {
  const names = { trend: "Trend", momentum: "Momentum", htf: "Higher TF", structure: "Structure", sentiment: "Sentiment", fundamentals: "Fundamentals" };
  return Object.entries(names).map(([k, n]) => { const v = c[k] ?? 0;
    return `<div class="c"><span>${n}</span><div class="tbar"><i style="${v >= 0 ? "left:50%" : `left:${50 + v * 50}%`};width:${Math.abs(v) * 50}%;background:var(${v >= 0 ? "--up" : "--dn"})"></i></div><span class="${cls(v)} mono">${v > 0 ? "+" : ""}${v.toFixed(2)}</span></div>`; }).join("");
}
function tick() {
  const el = $("cd"); if (!el) return;
  const sec = TF_SEC[activeTf], left = sec - (Math.floor(Date.now() / 1000) % sec), m = Math.floor(left / 60), x = left % 60;
  el.textContent = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}
setInterval(tick, 1000);

// ---------- SCANNER
let scanning = false;
function renderScan() {
  const rows = watchList();
  const cell = (v) => { if (!v) return `<span class="mut">—</span>`; const i = VERDICT[v.verdict]({ direction: v.direction }); return `<span class="vb ${i.cls}">${i.short}${v.verdict === "ENTER_NOW" || v.verdict === "WAIT" ? " " + v.direction : ""}</span> <span class="mono mut">${v.prob}%</span>`; };
  const rank = (c) => Math.max(...[c?.v15, c?.v1h].map((v) => (v && (v.verdict === "ENTER_NOW" || v.verdict === "WAIT") ? v.prob + (v.verdict === "ENTER_NOW" ? 100 : 0) : -1)));
  const sorted = [...rows].sort((a, b) => rank(cache[b]) - rank(cache[a]));
  $("view-scan").innerHTML = `
    <div class="toolbar"><button class="runbtn" id="scanall">${scanning ? "Scanning…" : "Scan watchlist"}</button>
      <span class="mut" style="font-size:13px">Runs your ${rows.length} coins one by one (15m + 1h). Actionable setups float to the top.</span></div>
    <div class="card" style="padding:6px 14px"><table class="tbl"><thead><tr><th>Pair</th><th>Price</th><th>24h</th><th>15m</th><th>1h</th><th>Funding</th><th>Checked</th></tr></thead><tbody>
    ${sorted.map((s) => { const c = cache[s]; return `<tr class="row" data-s="${s}"><td class="mono"><b>${s}</b></td><td class="mono">${c ? fmt(c.price) : "—"}</td><td class="${cls(c?.change24h)} mono">${c ? pct(c.change24h, 2) : "—"}</td><td>${cell(c?.v15)}</td><td>${cell(c?.v1h)}</td><td class="mono">${c?.funding != null ? (c.funding * 100).toFixed(4) + "%" : "—"}</td><td class="mut">${c ? new Date(c.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never"}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  $("scanall").onclick = scanAll;
  document.querySelectorAll("#view-scan .row").forEach((r) => (r.onclick = () => { $("sym").value = r.dataset.s; go("dash"); run(); }));
}
async function scanAll() {
  if (scanning) return; scanning = true;
  const q = watchList(); let i = 0;
  const worker = async () => { while (i < q.length) { const s = q[i++]; try { await fetchAnalysis(s); } catch {} if (view === "scan") renderScan(); renderWatch(); } };
  renderScan();
  await Promise.all([worker(), worker()]);
  scanning = false; if (view === "scan") renderScan(); toast("Scan complete");
}

// ---------- SETTINGS
function renderSettings() {
  $("view-set").innerHTML = `
    <div class="card"><h3>Position sizing defaults</h3><div class="sf">
      <label>Account size (USDT)<input id="s-bal" type="number" min="1" value="${S.bal}"></label>
      <label>Risk per trade (%)<input id="s-risk" type="number" min="0.1" step="0.1" value="${S.risk}"></label>
      <label>Leverage (x)<input id="s-lev" type="number" min="1" max="125" value="${S.lev}"></label>
      <label>Auto-refresh every (sec)<input id="s-ref" type="number" min="20" step="10" value="${S.refresh}"></label></div>
      <h3 style="margin-top:6px">Watchlist</h3><div class="sf"><label style="grid-column:1/-1">Comma-separated perp symbols<textarea id="s-watch" rows="2">${esc(S.watch)}</textarea></label></div>
      <div class="toolbar"><button class="runbtn" id="s-save">Save</button><button class="btn2" id="s-tg" style="padding:10px 18px">Send Telegram test</button></div>
      <p class="mut" style="font-size:12.5px">These are stored in this browser only. The Telegram alert watcher uses its own list (<span class="mono">WATCHLIST</span> in <span class="mono">worker/wrangler.toml</span>).</p></div>`;
  $("s-save").onclick = () => {
    S = { bal: +$("s-bal").value || 1000, risk: +$("s-risk").value || 1, lev: +$("s-lev").value || 10, refresh: Math.max(20, +$("s-ref").value || 60), watch: $("s-watch").value.toUpperCase() || DEFAULTS.watch };
    store.set("jev.settings", S); renderWatch(); if (current) renderRight(current); toast("Saved");
  };
  $("s-tg").onclick = async () => {
    const r = await fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: "BTCUSDT" }) });
    toast(r.ok ? "Test sent — check Telegram" : (await r.json()).error || "Telegram failed");
  };
}

// ---------- boot
renderWatch();

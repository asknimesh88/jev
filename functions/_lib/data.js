// Market-data adapters. Public, key-less endpoints only. Every optional source fails soft.

async function getJSON(url, ms = 8000, cache = 0) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { accept: "application/json", "user-agent": "jev-dashboard/1.0" },
    ...(cache ? { cf: { cacheTtl: cache, cacheEverything: true } } : {}),
  });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  return r.json();
}

const TF = {
  "15m": { binance: "15m", bybit: "15", okx: "15m" },
  "1h": { binance: "1h", bybit: "60", okx: "1H" },
  "4h": { binance: "4h", bybit: "240", okx: "4H" },
  "1d": { binance: "1d", bybit: "D", okx: "1D" },
};

const candle = (t, o, h, l, c, v) => ({ t: Math.floor(+t / 1000), o: +o, h: +h, l: +l, c: +c, v: +v });

const okxInst = (symbol) => {
  const q = ["USDT", "USDC"].find((x) => symbol.endsWith(x));
  return q ? `${symbol.slice(0, -q.length)}-${q}-SWAP` : symbol;
};

// Perpetual-futures candles. Returns { candles (oldest→newest, last = live/forming candle), source }.
// Tries Bybit linear → Binance USD-M → OKX swap, since some exchanges geo-block some Cloudflare regions.
export async function getKlines(symbol, tf, limit = 300) {
  const errs = [];
  try {
    const d = await getJSON(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${TF[tf].bybit}&limit=${limit}`);
    if (d.retCode === 0 && d.result.list.length) {
      return { source: "Bybit Perp", candles: d.result.list.map((k) => candle(k[0], k[1], k[2], k[3], k[4], k[5])).reverse() };
    }
    errs.push("bybit: " + d.retMsg);
  } catch (e) { errs.push(e.message); }
  try {
    const d = await getJSON(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${TF[tf].binance}&limit=${limit}`);
    return { source: "Binance Perp", candles: d.map((k) => candle(k[0], k[1], k[2], k[3], k[4], k[5])) };
  } catch (e) { errs.push(e.message); }
  try {
    const d = await getJSON(`https://www.okx.com/api/v5/market/candles?instId=${okxInst(symbol)}&bar=${TF[tf].okx}&limit=${Math.min(limit, 300)}`);
    if (d.code === "0" && d.data.length) {
      return { source: "OKX Perp", candles: d.data.map((k) => candle(k[0], k[1], k[2], k[3], k[4], k[5])).reverse() };
    }
    errs.push("okx: " + d.msg);
  } catch (e) { errs.push(e.message); }
  throw new Error(`No perp market data for ${symbol} (${errs.join("; ")})`);
}

// Derivatives sentiment: funding rate, open interest, long/short ratio. All optional.
export async function getDerivatives(symbol) {
  const out = { available: false };
  // Bybit first (primary venue)
  const [tk, ratio] = await Promise.allSettled([
    getJSON(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, 5000),
    getJSON(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symbol}&period=1h&limit=1`, 5000),
  ]);
  const t = tk.status === "fulfilled" ? tk.value.result?.list?.[0] : null;
  if (t) {
    out.funding = +t.fundingRate; out.openInterestValue = +t.openInterestValue; out.markPrice = +t.markPrice;
    out.change24h = +t.price24hPcnt * 100; out.available = true; out.source = "Bybit";
  }
  const r = ratio.status === "fulfilled" ? ratio.value.result?.list?.[0] : null;
  if (r && +r.sellRatio) out.longShort = +r.buyRatio / +r.sellRatio;
  // Binance fills any gaps
  if (out.funding == null || out.longShort == null) {
    const [prem, ls] = await Promise.allSettled([
      getJSON(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, 5000),
      getJSON(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`, 5000),
    ]);
    if (out.funding == null && prem.status === "fulfilled") { out.funding = +prem.value.lastFundingRate; out.available = true; out.source = "Binance Futures"; }
    if (out.longShort == null && ls.status === "fulfilled" && ls.value[0]) out.longShort = +ls.value[0].longShortRatio;
  }
  return out;
}

export async function getFearGreed() {
  try {
    const d = await getJSON("https://api.alternative.me/fng/?limit=2", 5000, 600);
    const [now, prev] = d.data;
    return { value: +now.value, label: now.value_classification, previous: prev ? +prev.value : null };
  } catch { return null; }
}

const QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USD", "EUR", "BTC", "ETH", "BNB"];
export const baseOf = (symbol) => {
  let b = symbol;
  for (const q of QUOTES) if (symbol.endsWith(q) && symbol.length > q.length) { b = symbol.slice(0, -q.length); break; }
  return b.replace(/^(1000000|1000|1M)(?=[A-Z])/, ""); // 1000PEPE → PEPE
};

// Fundamentals from CoinGecko (free tier, cached at the edge).
export async function getFundamentals(symbol) {
  const base = baseOf(symbol);
  try {
    const s = await getJSON(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(base)}`, 6000, 3600);
    const hit = s.coins.find((c) => c.symbol.toUpperCase() === base) || null;
    if (!hit) return null;
    const c = await getJSON(
      `https://api.coingecko.com/api/v3/coins/${hit.id}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
      7000, 900);
    const m = c.market_data || {};
    return {
      name: c.name, symbol: base, rank: c.market_cap_rank,
      marketCap: m.market_cap?.usd, volume24h: m.total_volume?.usd,
      change7d: m.price_change_percentage_7d, change30d: m.price_change_percentage_30d, change1y: m.price_change_percentage_1y,
      athChange: m.ath_change_percentage?.usd,
      circulating: m.circulating_supply, maxSupply: m.max_supply, totalSupply: m.total_supply,
      volumeToMcap: m.market_cap?.usd ? m.total_volume.usd / m.market_cap.usd : null,
      communityUp: c.sentiment_votes_up_percentage,
      categories: (c.categories || []).slice(0, 3),
    };
  } catch { return null; }
}

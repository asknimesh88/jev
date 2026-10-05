// Pure technical-indicator math. All functions return arrays aligned to the input (null = not enough data).

export function sma(v, p) {
  const out = Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= p) s -= v[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}

export function ema(v, p) {
  const out = Array(v.length).fill(null);
  if (v.length < p) return out;
  const k = 2 / (p + 1);
  let prev = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(c, p = 14) {
  const out = Array(c.length).fill(null);
  if (c.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const d = c[i] - c[i - 1];
    d >= 0 ? (g += d) : (l -= d);
  }
  g /= p; l /= p;
  out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (p - 1) + Math.max(d, 0)) / p;
    l = (l * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

const trueRange = (h, l, c, i) => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));

export function atr(h, l, c, p = 14) {
  const out = Array(c.length).fill(null);
  if (c.length <= p) return out;
  let a = 0;
  for (let i = 1; i <= p; i++) a += trueRange(h, l, c, i);
  a /= p;
  out[p] = a;
  for (let i = p + 1; i < c.length; i++) {
    a = (a * (p - 1) + trueRange(h, l, c, i)) / p;
    out[i] = a;
  }
  return out;
}

export function macd(c, f = 12, s = 26, sig = 9) {
  const ef = ema(c, f), es = ema(c, s);
  const line = c.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const first = line.findIndex((x) => x != null);
  const signal = Array(c.length).fill(null);
  if (first >= 0) {
    const sg = ema(line.slice(first), sig);
    sg.forEach((x, i) => (signal[first + i] = x));
  }
  const hist = line.map((x, i) => (x != null && signal[i] != null ? x - signal[i] : null));
  return { line, signal, hist };
}

export function bollinger(c, p = 20, k = 2) {
  const mid = sma(c, p);
  const up = Array(c.length).fill(null), lo = Array(c.length).fill(null);
  for (let i = p - 1; i < c.length; i++) {
    let v = 0;
    for (let j = i - p + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / p);
    up[i] = mid[i] + k * sd;
    lo[i] = mid[i] - k * sd;
  }
  return { mid, up, lo };
}

export function adx(h, l, c, p = 14) {
  const n = c.length;
  const out = { adx: Array(n).fill(null), pdi: Array(n).fill(null), mdi: Array(n).fill(null) };
  if (n < p * 2 + 1) return out;
  let tr = 0, pdm = 0, mdm = 0;
  const dxs = [];
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    const t = trueRange(h, l, c, i);
    const pd = up > dn && up > 0 ? up : 0;
    const md = dn > up && dn > 0 ? dn : 0;
    if (i <= p) {
      tr += t; pdm += pd; mdm += md;
      if (i < p) continue;
    } else {
      tr = tr - tr / p + t;
      pdm = pdm - pdm / p + pd;
      mdm = mdm - mdm / p + md;
    }
    const pdi = (100 * pdm) / tr, mdi = (100 * mdm) / tr;
    out.pdi[i] = pdi; out.mdi[i] = mdi;
    const dx = (pdi + mdi) === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
    dxs.push([i, dx]);
  }
  if (dxs.length >= p) {
    let a = dxs.slice(0, p).reduce((s, [, d]) => s + d, 0) / p;
    out.adx[dxs[p - 1][0]] = a;
    for (let k = p; k < dxs.length; k++) {
      a = (a * (p - 1) + dxs[k][1]) / p;
      out.adx[dxs[k][0]] = a;
    }
  }
  return out;
}

// Pivot highs/lows (support & resistance candidates)
export function pivots(h, l, w = 3) {
  const highs = [], lows = [];
  for (let i = w; i < h.length - w; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= w; j++) {
      if (h[i] < h[i - j] || h[i] < h[i + j]) isH = false;
      if (l[i] > l[i - j] || l[i] > l[i + j]) isL = false;
    }
    if (isH) highs.push({ i, p: h[i] });
    if (isL) lows.push({ i, p: l[i] });
  }
  return { highs, lows };
}

export const last = (a) => a[a.length - 1];

"""Backtest of pine/jev_smc_confluence.pine on Bybit linear perps (Python port of the same logic, bar by bar).

usage: python3 pine/backtest.py [SYMBOL] [DAYS]        e.g. python3 pine/backtest.py BTCUSDT 730

ponytail: fundamentals use 30d performance only; CRYPTOCAP TOTAL / USDT.D aren't on the exchange API, so those
terms are 0 (neutral). Weight is 6% of the score plus checklist item 9, so the effect is small.
Fills: MKT at signal close; LIMIT at EMA20 if touched within 20 bars and before TP1. Same-bar SL+TP counts as SL.
"""
import json, os, ssl, sys, time, urllib.request
import numpy as np, pandas as pd

SYM = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
DAYS = int(sys.argv[2]) if len(sys.argv) > 2 else 730
FEE = 0.00055  # Bybit taker, per side
CFG = dict(minScore=0.30, minPass=8, minRR=1.5, poiBars=8, cooldown=10, swing=5, obKeep=3, fvgKeep=3, fvgMin=0.3, fvgDisp=0.8)
MIN = {"15": 15, "30": 30, "60": 60, "240": 240, "D": 1440, "W": 10080}
AUTO = {"15": ("60", "240"), "30": ("240", "D"), "60": ("240", "D"), "240": ("D", "W")}

ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt") if os.path.exists("/root/.ccr/ca-bundle.crt") else None


def klines(interval, days):
    end, out = int(time.time() * 1000), []
    start = end - days * 86400_000
    while end > start:
        url = f"https://api.bybit.com/v5/market/kline?category=linear&symbol={SYM}&interval={interval}&limit=1000&end={end}"
        rows = json.load(urllib.request.urlopen(url, context=ctx, timeout=30))["result"]["list"]
        if not rows:
            break
        out += rows
        end = int(rows[-1][0]) - 1
    df = pd.DataFrame(out, columns=["t", "o", "h", "l", "c", "v", "turnover"]).astype(float).drop_duplicates("t").sort_values("t")
    df = df[df.t >= start].reset_index(drop=True)
    return df.iloc[:-1]  # drop the still-open candle


rma = lambda s, n: s.ewm(alpha=1 / n, adjust=False).mean()
ema = lambda s, n: s.ewm(span=n, adjust=False).mean()


def indicators(df):
    h, l, c = df.h, df.l, df.c
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    df["atr"] = rma(tr, 14)
    df["e20"], df["e50"], df["e200"] = ema(c, 20), ema(c, 50), ema(c, 200)
    d = c.diff()
    df["rsi"] = 100 - 100 / (1 + rma(d.clip(lower=0), 14) / rma(-d.clip(upper=0), 14))
    macd = ema(c, 12) - ema(c, 26)
    df["hist"] = macd - ema(macd, 9)
    up, dn = h.diff(), -l.diff()
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    mdm = np.where((dn > up) & (dn > 0), dn, 0.0)
    trr = rma(tr, 14)
    pdi, mdi = 100 * rma(pd.Series(pdm), 14) / trr, 100 * rma(pd.Series(mdm), 14) / trr
    df["adx"] = 100 * rma((pdi - mdi).abs() / (pdi + mdi), 14)
    df["bbMid"] = c.rolling(20).mean()
    df["bbUp"] = df.bbMid + 2 * c.rolling(20).std(ddof=0)
    df["volSma"] = df.v.rolling(20).mean()
    stack = ((c > df.e20).astype(int) + (df.e20 > df.e50).astype(int) + (df.e50 > df.e200).astype(int) - 1.5) / 1.5
    df["trend"] = (stack * (0.55 + 0.45 * np.minimum(df.adx.fillna(15) / 30, 1))).clip(-1, 1)
    return df


def htf_series(df, tf):
    """Pine request.security(tf, trendS[1], lookahead_on): value of the last *closed* HTF bar."""
    hd = indicators(klines(tf, DAYS + 400))
    idx = np.searchsorted(hd.t.values, df.t.values, side="right") - 2  # bar containing t, minus one
    vals = hd.trend.values
    return np.where(idx >= 0, vals[np.clip(idx, 0, None)], 0.0)


def run(tf):
    df = indicators(klines(tf, DAYS))
    hA, hB = AUTO[tf]
    htf = (htf_series(df, hA) + htf_series(df, hB)) / 2
    daily = klines("D", DAYS + 60)
    di = np.searchsorted(daily.t.values, df.t.values, side="right") - 2  # yesterday's close
    dc = daily.c.values
    chg30 = np.array([dc[k] / dc[k - 30] - 1 if k >= 30 else 0.0 for k in di])
    fund = np.clip(chg30 * 100 / 40, -0.4, 0.4)

    o, h, l, c, v = (df[k].values for k in "ohlcv")
    atr, e20, e50, e200, rsi, hist, adx = (df[k].values for k in ["atr", "e20", "e50", "e200", "rsi", "hist", "adx"])
    bbMid, bbUp, volSma, trend = df.bbMid.values, df.bbUp.values, df.volSma.values, df.trend.values
    L, n = CFG["swing"], len(df)
    pH, pL = [], []
    sh = sl = None  # [price, index, used]
    smc = 0
    zones = {k: [] for k in ("bullOB", "bearOB", "bullF", "bearF")}  # [top, bot, strength]
    lastBullTap = lastBearTap = None
    lastDir, lastSig = 0, -10**9
    sigs = []

    def add(z, top, bot, s, keep):
        if keep > 0 and (len(z) < keep or s > min(x[2] for x in z)):
            if len(z) >= keep:
                z.remove(min(z, key=lambda x: x[2]))
            z.append([top, bot, s])

    def update(z, bull, i):
        t = False
        for zz in list(z):
            top, bot = zz[0], zz[1]
            if (c[i] < bot) if bull else (c[i] > top):
                z.remove(zz)
            elif (l[i] <= top and c[i] > bot) if bull else (h[i] >= bot and c[i] < top):
                t = True
        return t

    def plan(i, sgn):
        ext = (c[i] - e20[i]) / atr[i] * sgn
        entry = c[i] if ext <= 0.35 else e20[i]
        swing = max([p for p in pL if p < entry], default=None) if sgn == 1 else min([p for p in pH if p > entry], default=None)
        risk = 1.5 * atr[i] if swing is None else abs(entry - swing) + 0.25 * atr[i]
        risk = min(max(risk, atr[i]), 2.5 * atr[i])
        obst = min([p for p in pH if p > c[i]], default=None) if sgn == 1 else max([p for p in pL if p < c[i]], default=None)
        obsR = 99.0 if obst is None else abs(obst - entry) / risk
        tp1, tp2 = entry + sgn * risk * 1.5, entry + sgn * risk * 2.5
        if 1.2 <= obsR < 2.5:
            tp2 = entry + sgn * abs(obst - entry) * 0.98
            if obsR < 1.5:
                tp1 = entry + sgn * abs(obst - entry) * 0.9
        return dict(entry=entry, sl=entry - sgn * risk, tp1=tp1, tp2=tp2, obsR=obsR, ext=ext, limit=ext > 0.35)

    for i in range(2, n):
        # pivots confirmed at i (center i-L)
        if i >= 2 * L:
            cI = i - L
            if h[cI] > h[cI + 1:i + 1].max() and h[cI] >= h[cI - L:cI].max():
                sh = [h[cI], cI, False]; pH.append(h[cI]); pH[:] = pH[-20:]
            if l[cI] < l[cI + 1:i + 1].min() and l[cI] <= l[cI - L:cI].min():
                sl = [l[cI], cI, False]; pL.append(l[cI]); pL[:] = pL[-20:]
        tb = update(zones["bullOB"], True, i) | update(zones["bullF"], True, i)
        ts = update(zones["bearOB"], False, i) | update(zones["bearF"], False, i)
        if sh and not sh[2] and c[i] > sh[0]:
            sh[2] = True; smc = 1
            span = min(i - (sl[1] if sl else sh[1]), 300)
            k = None
            for j in range(i - 1, i - span - 1, -1):
                if c[j] < o[j] and (k is None or l[j] < l[k]):
                    k = j
            if k is not None:
                add(zones["bullOB"], h[k], l[k], i, CFG["obKeep"])
        if sl and not sl[2] and c[i] < sl[0]:
            sl[2] = True; smc = -1
            span = min(i - (sh[1] if sh else sl[1]), 300)
            k = None
            for j in range(i - 1, i - span - 1, -1):
                if c[j] > o[j] and (k is None or h[j] > h[k]):
                    k = j
            if k is not None:
                add(zones["bearOB"], h[k], l[k], i, CFG["obKeep"])
        body1, rng1 = abs(c[i - 1] - o[i - 1]), h[i - 1] - l[i - 1]
        disp = body1 / rng1 if rng1 > 0 else 0.0
        volF = min(v[i - 1] / volSma[i - 1], 3) if volSma[i - 1] > 0 else 1.0
        if l[i] > h[i - 2] and c[i - 1] > o[i - 1] and body1 >= CFG["fvgDisp"] * atr[i] and l[i] - h[i - 2] >= CFG["fvgMin"] * atr[i]:
            add(zones["bullF"], l[i], h[i - 2], (l[i] - h[i - 2]) / atr[i] * disp * volF, CFG["fvgKeep"])
        if h[i] < l[i - 2] and c[i - 1] < o[i - 1] and body1 >= CFG["fvgDisp"] * atr[i] and l[i - 2] - h[i] >= CFG["fvgMin"] * atr[i]:
            add(zones["bearF"], l[i - 2], h[i], (l[i - 2] - h[i]) / atr[i] * disp * volF, CFG["fvgKeep"])
        if tb: lastBullTap = i
        if ts: lastBearTap = i
        if i < 300:
            continue  # warm-up

        volRatio = v[i] / volSma[i] if volSma[i] > 0 else 1.0
        hi20, lo20 = h[i - 20:i].max(), l[i - 20:i].min()
        if c[i] > hi20: structure = np.clip(0.5 + (volRatio - 1) * 0.5, 0.3, 1)
        elif c[i] < lo20: structure = -np.clip(0.5 + (volRatio - 1) * 0.5, 0.3, 1)
        else: structure = np.clip((c[i] - bbMid[i]) / (bbUp[i] - bbMid[i]) * 0.4, -1, 1)
        momentum = 0.5 * np.clip((rsi[i] - 50) / 25, -1, 1) + 0.5 * np.clip(hist[i] / atr[i] * 4, -1, 1)
        score = trend[i] * 0.27 + momentum * 0.20 + htf[i] * 0.25 + structure * 0.10 + smc * 0.12 + fund[i] * 0.06
        pl_, ps_ = plan(i, 1), plan(i, -1)
        L_ = [score >= CFG["minScore"], htf[i] > 0.25, e20[i] > e50[i] > e200[i] and adx[i] >= 18,
              45 < rsi[i] < 75 and hist[i] > hist[i - 1], smc == 1,
              lastBullTap is not None and i - lastBullTap <= CFG["poiBars"] and c[i] > o[i], pl_["ext"] <= 1.0, pl_["obsR"] >= CFG["minRR"], fund[i] >= 0]
        S_ = [score <= -CFG["minScore"], htf[i] < -0.25, e20[i] < e50[i] < e200[i] and adx[i] >= 18,
              25 < rsi[i] < 55 and hist[i] < hist[i - 1], smc == -1,
              lastBearTap is not None and i - lastBearTap <= CFG["poiBars"] and c[i] < o[i], ps_["ext"] <= 1.0, ps_["obsR"] >= CFG["minRR"], fund[i] <= 0]
        choppy = adx[i] < 15 and abs(trend[i]) < 0.5
        longOK = L_[0] and L_[5] and L_[7] and sum(L_) >= CFG["minPass"] and not choppy
        shortOK = S_[0] and S_[5] and S_[7] and sum(S_) >= CFG["minPass"] and not choppy
        longSig = longOK and (lastDir != 1 or i - lastSig > CFG["cooldown"])
        shortSig = shortOK and not longSig and (lastDir != -1 or i - lastSig > CFG["cooldown"])
        if longSig or shortSig:
            lastDir, lastSig = (1, i) if longSig else (-1, i)
            sigs.append((i, 1 if longSig else -1, pl_ if longSig else ps_))
    return df, [simulate(df, *s) for s in sigs]


def simulate(df, i, sgn, p):
    h, l, c, t = df.h.values, df.l.values, df.c.values, df.t.values
    e, sl, t1, t2 = p["entry"], p["sl"], p["tp1"], p["tp2"]
    risk = abs(e - sl)
    j = i + 1
    if p["limit"]:  # wait for EMA20 fill, cancel on TP1 first or after 20 bars
        while j < len(c) and j <= i + 20:
            if (l[j] <= e) if sgn == 1 else (h[j] >= e):
                break
            if (h[j] >= t1) if sgn == 1 else (l[j] <= t1):
                return dict(t=t[i], dir=sgn, filled=False)
            j += 1
        else:
            return dict(t=t[i], dir=sgn, filled=False)
    fee = 2 * FEE * e / risk
    tp1hit, outA, outB = False, None, None  # A: all-out at TP2/SL, B: half at TP1 then stop to breakeven
    for k in range(j, min(len(c), j + 300)):
        hitSL = (l[k] <= sl) if sgn == 1 else (h[k] >= sl)
        hitT1 = (h[k] >= t1) if sgn == 1 else (l[k] <= t1)
        hitT2 = (h[k] >= t2) if sgn == 1 else (l[k] <= t2)
        rT1, rT2 = abs(t1 - e) / risk, abs(t2 - e) / risk
        if not tp1hit:
            if hitSL:
                return dict(t=t[i], dir=sgn, filled=True, tp1First=False, A=-1 - fee, B=-1 - fee)
            if hitT1:
                tp1hit = True
                if hitT2:
                    return dict(t=t[i], dir=sgn, filled=True, tp1First=True, A=rT2 - fee, B=(rT1 + rT2) / 2 - fee)
                continue
        else:
            beHit = (l[k] <= e) if sgn == 1 else (h[k] >= e)
            if outB is None and beHit:
                outB = rT1 / 2 - fee
            if hitSL and outA is None:
                return dict(t=t[i], dir=sgn, filled=True, tp1First=True, A=-1 - fee, B=outB if outB is not None else rT1 / 2 - fee)
            if hitT2:
                return dict(t=t[i], dir=sgn, filled=True, tp1First=True, A=rT2 - fee, B=outB if outB is not None else (rT1 + rT2) / 2 - fee)
    k = min(len(c), j + 300) - 1  # timeout: close at market
    r = (c[k] - e) * sgn / risk
    return dict(t=t[i], dir=sgn, filled=True, tp1First=tp1hit, A=r - fee, B=outB if outB is not None else ((abs(t1 - e) / risk + r) / 2 if tp1hit else r) - fee)


def report(tf, df, trades):
    f = [x for x in trades if x["filled"]]
    span = f"{pd.to_datetime(df.t.iloc[300], unit='ms'):%Y-%m-%d} → {pd.to_datetime(df.t.iloc[-1], unit='ms'):%Y-%m-%d}"
    row = dict(tf=tf, period=span, buyhold=f"{df.c.iloc[-1] / df.c.iloc[300] - 1:+.0%}", signals=len(trades), filled=len(f))
    if f:
        A, B = np.array([x["A"] for x in f]), np.array([x["B"] for x in f])
        def dd(r):
            eq = np.cumsum(r); return float((np.maximum.accumulate(eq) - eq).max())
        row.update(longs=sum(x["dir"] == 1 for x in f), shorts=sum(x["dir"] == -1 for x in f),
                   tp1_before_sl=f"{np.mean([x['tp1First'] for x in f]):.0%}",
                   winA=f"{(A > 0).mean():.0%}", avgR_A=round(A.mean(), 2), totR_A=round(A.sum(), 1), maxDD_A=round(dd(A), 1),
                   winB=f"{(B > 0).mean():.0%}", avgR_B=round(B.mean(), 2), totR_B=round(B.sum(), 1), maxDD_B=round(dd(B), 1))
        h1, h2 = A[: len(A) // 2], A[len(A) // 2:]
        row.update(avgR_A_1sthalf=round(h1.mean(), 2) if len(h1) else None, avgR_A_2ndhalf=round(h2.mean(), 2))
    return row


if __name__ == "__main__":
    tfs = sys.argv[3].split(",") if len(sys.argv) > 3 else ["15", "30", "60", "240"]
    rows = []
    for tf in tfs:
        df, trades = run(tf)
        rows.append(report(tf, df, trades))
        print(json.dumps(rows[-1]), flush=True)
    print(pd.DataFrame(rows).set_index("tf").T.to_string())

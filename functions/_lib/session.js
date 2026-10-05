const enc = new TextEncoder();
export const COOKIE = "jev_session";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const secretOf = (env) => env.SESSION_SECRET || env.JEV_PASSWORD;

// Constant-time-ish password comparison (compares HMACs, so lengths never leak).
export async function passwordMatches(input, env) {
  const [a, b] = await Promise.all([hmac("cmp", String(input)), hmac("cmp", String(env.JEV_PASSWORD))]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeSessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const sig = await hmac(secretOf(env), "jev." + exp);
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export async function verifySession(request, env) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([a-f0-9]+)`));
  if (!m) return false;
  const [, exp, sig] = m;
  if (Number(exp) < Date.now() / 1000) return false;
  const good = await hmac(secretOf(env), "jev." + exp);
  if (good.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < good.length; i++) diff |= good.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

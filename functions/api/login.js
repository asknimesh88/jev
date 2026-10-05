import { passwordMatches, makeSessionCookie, COOKIE } from "../_lib/session.js";

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  if (await passwordMatches(body.password ?? "", env)) {
    return json({ ok: true }, 200, { "set-cookie": await makeSessionCookie(env) });
  }
  await new Promise((r) => setTimeout(r, 600)); // slow down brute force
  return json({ ok: false, error: "Wrong password" }, 401);
}

// GET /api/login?logout=1 clears the session
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  if (url.searchParams.get("logout")) {
    return new Response(null, {
      status: 302,
      headers: { location: "/login", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` },
    });
  }
  return json({ error: "method not allowed" }, 405);
}

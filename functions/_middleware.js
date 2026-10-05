// Password gate for the whole site (pages + API). Runs on every request.
// Session = signed, expiring, HttpOnly cookie. Set JEV_PASSWORD (and optionally SESSION_SECRET) in Cloudflare.
import { verifySession } from "./_lib/session.js";

const OPEN = new Set(["/login", "/login.html", "/api/login", "/favicon.svg", "/api/telegram"]); // /api/telegram self-authenticates via secret token

export async function onRequest({ request, env, next }) {
  if (!env.JEV_PASSWORD) {
    return new Response("JEV_PASSWORD is not configured. Set it in Cloudflare Pages → Settings → Variables and Secrets.", { status: 500 });
  }
  const url = new URL(request.url);
  let res;
  if (OPEN.has(url.pathname) || (await verifySession(request, env))) {
    res = await next();
  } else if (url.pathname.startsWith("/api/")) {
    res = new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  } else {
    res = Response.redirect(new URL("/login", url).toString(), 302);
  }
  const out = new Response(res.body, res);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  out.headers.set("X-Frame-Options", "DENY");
  out.headers.set("Referrer-Policy", "no-referrer");
  return out;
}
